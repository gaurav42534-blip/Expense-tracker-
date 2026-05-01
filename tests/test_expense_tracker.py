# -*- coding: utf-8 -*-
"""
Expense Tracker — full Playwright test suite.
Covers: page load, navigation, add transaction, balance calculation,
filters, dark mode, category management, delete, empty states, chart.
"""

import sys
import re
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

# Force UTF-8 output so rupee symbol (₹) doesn't crash on Windows cp1252
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr.encoding != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

APP_PATH = Path(__file__).parent.parent / "index.html"
APP_URL = APP_PATH.as_uri()

TODAY = "2026-05-01"  # fixed date so tests are deterministic

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def fresh_page(ctx):
    """Return a page with clean localStorage (ctx = BrowserContext)."""
    page = ctx.new_page()
    page.goto(APP_URL, wait_until="domcontentloaded")
    page.evaluate("localStorage.clear()")
    page.reload(wait_until="domcontentloaded")
    return page


def seed_transactions(page, txns):
    """Inject transactions directly into localStorage and reload."""
    # Derive categories from seeded data so IDs match app's seed logic
    cats = page.evaluate("""() => {
        const key = 'expense-tracker:categories';
        return JSON.parse(localStorage.getItem(key) || '[]');
    }""")

    # Build cat map: name.lower() -> id
    cat_map = {c["name"].lower(): c["id"] for c in cats}

    # Resolve category ids
    resolved = []
    for i, t in enumerate(txns):
        cat_id = cat_map.get(t.get("category", "").lower(),
                             f"cat-{'income' if t['type'] == 'income' else 'expense'}-other")
        resolved.append({
            "id": f"txn-test-{i}",
            "type": t["type"],
            "amount": t["amount"],
            "category": cat_id,
            "date": t.get("date", TODAY),
            "note": t.get("note", ""),
            "createdAt": 1700000000000 + i,
        })

    page.evaluate("""(txns) => {
        localStorage.setItem('expense-tracker:transactions', JSON.stringify(txns));
    }""", resolved)
    page.reload(wait_until="domcontentloaded")


def add_transaction(page, type_="expense", amount="500", category_name=None, note="Test note", date=TODAY):
    """Fill and submit the Add Transaction form."""
    page.click('button[data-target="add"]')
    page.wait_for_selector("#txn-form", state="visible")

    # Select type
    page.click(f'input[name="type"][value="{type_}"]')

    # Amount
    page.fill("#amount", amount)

    # Category — pick the first matching option if name given
    if category_name:
        page.select_option("#category", label=category_name)

    # Date
    page.fill("#date", date)

    # Note
    page.fill("#note", note)

    page.click('button[type="submit"]')
    page.wait_for_timeout(500)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_page_loads(browser):
    page = fresh_page(browser)
    assert "Expense Tracker" in page.title()
    # Header brand visible
    expect(page.locator(".brand__name")).to_be_visible()
    print("PASS: page loads with correct title and header")


def test_empty_state_message(browser):
    page = fresh_page(browser)
    tbody = page.locator("#recent-tbody")
    expect(tbody).to_contain_text("No transactions yet")
    print("PASS: empty state message shown on fresh load")


def test_navigation_tabs(browser):
    page = fresh_page(browser)

    # Add tab
    page.click('button[data-target="add"]')
    expect(page.locator("#add")).to_have_class(re.compile(r"is-active"))

    # Reports tab
    page.click('button[data-target="reports"]')
    expect(page.locator("#reports")).to_have_class(re.compile(r"is-active"))

    # Home tab
    page.click('button[data-target="home"]')
    expect(page.locator("#home")).to_have_class(re.compile(r"is-active"))
    print("PASS: navigation tabs switch views correctly")


def test_add_expense_transaction(browser):
    page = fresh_page(browser)
    add_transaction(page, type_="expense", amount="1200", note="Groceries")

    # Should land back on home (or show the transaction)
    page.click('button[data-target="home"]')
    tbody = page.locator("#recent-tbody")
    expect(tbody).to_contain_text("Groceries")
    expect(tbody).to_contain_text("1,200")
    print("PASS: expense transaction added and visible in table")


def test_add_income_transaction(browser):
    page = fresh_page(browser)
    add_transaction(page, type_="income", amount="50000", note="Monthly salary")

    page.click('button[data-target="home"]')
    tbody = page.locator("#recent-tbody")
    expect(tbody).to_contain_text("Monthly salary")
    expect(tbody).to_contain_text("50,000")
    print("PASS: income transaction added and visible in table")


def test_balance_calculation(browser):
    page = fresh_page(browser)

    # income 10000, expense 3000 → closing balance = 7000
    seed_transactions(page, [
        {"type": "income",  "amount": 10000, "category": "Salary",    "note": "salary",  "date": TODAY},
        {"type": "expense", "amount": 3000,  "category": "Food",      "note": "food",    "date": TODAY},
    ])

    balance_text = page.locator("#sum-balance").inner_text()
    assert "7,000" in balance_text, f"Expected 7,000 in balance, got: {balance_text}"
    print("PASS: balance calculation correct")


def test_income_and_expense_summary_cards(browser):
    page = fresh_page(browser)
    seed_transactions(page, [
        {"type": "income",  "amount": 15000, "category": "Salary", "date": TODAY},
        {"type": "income",  "amount": 5000,  "category": "Freelance", "date": TODAY},
        {"type": "expense", "amount": 2000,  "category": "Bills", "date": TODAY},
    ])

    income_text  = page.locator("#sum-income").inner_text()
    expense_text = page.locator("#sum-expense").inner_text()

    assert "20,000" in income_text,  f"Income card wrong: {income_text}"
    assert "2,000"  in expense_text, f"Expense card wrong: {expense_text}"
    print("PASS: income and expense summary cards correct")


def test_delete_transaction(browser):
    page = fresh_page(browser)
    seed_transactions(page, [
        {"type": "expense", "amount": 999, "category": "Food", "note": "delete me", "date": TODAY},
    ])

    # Confirm it's there
    expect(page.locator("#recent-tbody")).to_contain_text("delete me")

    # Click delete — app shows a confirm() dialog, auto-accept it
    page.once("dialog", lambda d: d.accept())
    page.click('[data-action="delete"]')

    # Should show empty state again
    expect(page.locator("#recent-tbody")).to_contain_text("No transactions yet")
    print("PASS: transaction deleted successfully")


def test_filter_by_type_income(browser):
    page = fresh_page(browser)
    seed_transactions(page, [
        {"type": "income",  "amount": 5000, "category": "Salary",    "note": "salary pmt",  "date": TODAY},
        {"type": "expense", "amount": 200,  "category": "Transport", "note": "bus ticket",  "date": TODAY},
    ])

    page.select_option("#home-filter-type", value="income")
    page.wait_for_load_state("networkidle")

    tbody = page.locator("#recent-tbody")
    expect(tbody).to_contain_text("salary pmt")
    expect(tbody).not_to_contain_text("bus ticket")
    print("PASS: filter by type=income hides expense rows")


def test_filter_by_type_expense(browser):
    page = fresh_page(browser)
    seed_transactions(page, [
        {"type": "income",  "amount": 5000, "category": "Salary",    "note": "salary pmt",  "date": TODAY},
        {"type": "expense", "amount": 200,  "category": "Transport", "note": "bus ticket",  "date": TODAY},
    ])

    page.select_option("#home-filter-type", value="expense")
    page.wait_for_load_state("networkidle")

    tbody = page.locator("#recent-tbody")
    expect(tbody).not_to_contain_text("salary pmt")
    expect(tbody).to_contain_text("bus ticket")
    print("PASS: filter by type=expense hides income rows")


def test_dark_mode_toggle(browser):
    page = fresh_page(browser)

    # Open menu
    page.click("#menu-toggle")
    page.wait_for_selector("#app-menu", state="visible")

    # The checkbox is visually hidden behind a CSS thumb — use JS to trigger it
    toggle = page.locator("#theme-toggle")
    expect(toggle).to_be_attached()

    # Initially light mode
    initial_class = page.locator("body").get_attribute("class") or ""
    assert "dark" not in initial_class, "Should start in light mode"

    # Toggle dark mode via JS (CSS overlay blocks pointer events)
    page.evaluate("document.getElementById('theme-toggle').click()")
    page.wait_for_timeout(300)
    dark_class = page.locator("body").get_attribute("class") or ""
    dark_attr  = page.locator("html").get_attribute("data-theme") or ""
    dark_ok = "dark" in dark_class or dark_attr == "dark"
    assert dark_ok, f"Dark mode not applied. body class='{dark_class}', data-theme='{dark_attr}'"

    # Toggle back
    page.evaluate("document.getElementById('theme-toggle').click()")
    page.wait_for_timeout(300)
    print("PASS: dark mode toggle works")


def test_category_dropdown_populated(browser):
    page = fresh_page(browser)
    page.click('button[data-target="add"]')
    page.wait_for_selector("#category", state="visible")

    # Select expense type and check categories exist
    page.click('input[name="type"][value="expense"]')
    page.wait_for_timeout(200)
    options = page.locator("#category option").all()
    assert len(options) > 0, "Category dropdown should have options"
    labels = [o.inner_text() for o in options]
    # Seed categories include Food, Transport, Bills etc
    assert any("Food" in l or "Transport" in l or "Bills" in l for l in labels), \
        f"Expected seed categories, got: {labels}"
    print(f"PASS: category dropdown has {len(options)} options including seed categories")


def test_category_switches_with_type(browser):
    page = fresh_page(browser)
    page.click('button[data-target="add"]')
    page.wait_for_selector("#category")

    # Income categories
    page.click('input[name="type"][value="income"]')
    page.wait_for_timeout(200)
    income_options = [o.inner_text() for o in page.locator("#category option").all()]

    # Expense categories
    page.click('input[name="type"][value="expense"]')
    page.wait_for_timeout(200)
    expense_options = [o.inner_text() for o in page.locator("#category option").all()]

    assert income_options != expense_options, "Category list should differ between income and expense"
    print("PASS: category dropdown updates when type changes")


def test_reports_transaction_count(browser):
    page = fresh_page(browser)
    seed_transactions(page, [
        {"type": "expense", "amount": 100, "category": "Food",      "note": "n1", "date": TODAY},
        {"type": "expense", "amount": 200, "category": "Transport", "note": "n2", "date": TODAY},
        {"type": "income",  "amount": 300, "category": "Salary",    "note": "n3", "date": TODAY},
    ])

    page.click('button[data-target="reports"]')
    # Set filter to all months to see everything
    page.select_option("#filter-month", value="all")
    page.wait_for_timeout(300)

    count_text = page.locator("#count-label").inner_text()
    assert "3" in count_text, f"Expected 3 entries, got: {count_text}"
    print(f"PASS: reports shows correct count — {count_text}")


def test_manage_categories_panel_opens(browser):
    page = fresh_page(browser)
    page.click("#menu-toggle")
    page.wait_for_selector("#app-menu", state="visible")
    page.click('button[data-target="categories"]')
    # categories section should become active
    expect(page.locator("#categories")).to_have_class(re.compile(r"is-active"))
    print("PASS: Manage Categories panel opens from menu")


def test_import_statement_file_input(browser):
    page = fresh_page(browser)
    page.click("#menu-toggle")
    page.wait_for_selector("#app-menu", state="visible")
    # The import button should exist
    import_btn = page.locator("#import-stmt-btn")
    expect(import_btn).to_be_visible()
    # The hidden file input should exist
    file_input = page.locator("#stmt-file-input")
    assert file_input.count() == 1, "File input for statement import not found"
    print("PASS: Import Statement button and file input are present")


def test_cancel_resets_form(browser):
    page = fresh_page(browser)
    page.click('button[data-target="add"]')
    page.fill("#amount", "9999")
    page.fill("#note", "should be cleared")
    page.click('button[type="reset"]')
    page.wait_for_timeout(200)

    amount_val = page.locator("#amount").input_value()
    note_val   = page.locator("#note").input_value()
    assert amount_val == "" or amount_val == "0", f"Amount not reset: {amount_val}"
    assert note_val == "", f"Note not reset: {note_val}"
    print("PASS: Cancel button resets form fields")


def test_chart_canvas_exists(browser):
    page = fresh_page(browser)
    seed_transactions(page, [
        {"type": "expense", "amount": 1000, "category": "Food",      "date": TODAY},
        {"type": "expense", "amount": 500,  "category": "Transport", "date": TODAY},
    ])
    page.click('button[data-target="reports"]')
    canvas = page.locator("#expense-pie")
    expect(canvas).to_be_visible()
    print("PASS: expense chart canvas is visible in Reports")


def test_transaction_persists_after_reload(browser):
    page = fresh_page(browser)
    add_transaction(page, type_="income", amount="7777", note="persist test")

    # Reload page (simulates closing and reopening app)
    page.reload(wait_until="domcontentloaded")
    page.click('button[data-target="home"]')

    tbody = page.locator("#recent-tbody")
    expect(tbody).to_contain_text("persist test")
    print("PASS: transaction persists in localStorage after reload")


def test_multiple_transactions_balance(browser):
    page = fresh_page(browser)
    # opening balance: prior month income 20000
    prior = "2026-04-15"
    seed_transactions(page, [
        {"type": "income",  "amount": 20000, "category": "Salary",    "date": prior},   # opening
        {"type": "income",  "amount": 8000,  "category": "Freelance", "date": TODAY},   # this month
        {"type": "expense", "amount": 3000,  "category": "Bills",     "date": TODAY},   # this month
    ])
    # closing = 20000 (opening) + 8000 (income) - 3000 (expense) = 25000
    balance_text = page.locator("#sum-balance").inner_text()
    assert "25,000" in balance_text, f"Expected 25,000 in balance, got: {balance_text}"
    print("PASS: multi-month balance calculation correct (opening + this month)")


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run_all():
    tests = [
        test_page_loads,
        test_empty_state_message,
        test_navigation_tabs,
        test_add_expense_transaction,
        test_add_income_transaction,
        test_balance_calculation,
        test_income_and_expense_summary_cards,
        test_delete_transaction,
        test_filter_by_type_income,
        test_filter_by_type_expense,
        test_dark_mode_toggle,
        test_category_dropdown_populated,
        test_category_switches_with_type,
        test_reports_transaction_count,
        test_manage_categories_panel_opens,
        test_import_statement_file_input,
        test_cancel_resets_form,
        test_chart_canvas_exists,
        test_transaction_persists_after_reload,
        test_multiple_transactions_balance,
    ]

    passed, failed = [], []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for test_fn in tests:
            name = test_fn.__name__
            # Run each test in a fresh browser context so pages don't accumulate
            ctx = browser.new_context()
            try:
                test_fn(ctx)
                passed.append(name)
            except Exception as e:
                err_msg = str(e).encode("ascii", errors="replace").decode("ascii")
                failed.append((name, err_msg))
                print(f"FAIL: {name} -- {err_msg}")
            finally:
                ctx.close()
        browser.close()

    print("\n" + "="*60)
    print(f"Results: {len(passed)} passed, {len(failed)} failed out of {len(tests)} tests")
    print("="*60)

    if passed:
        print("\nPassed:")
        for n in passed:
            print(f"  ✓ {n}")

    if failed:
        print("\nFailed:")
        for n, err in failed:
            print(f"  ✗ {n}")
            print(f"      {err}")

    return len(failed) == 0


if __name__ == "__main__":
    import sys
    ok = run_all()
    sys.exit(0 if ok else 1)
