// Expense tracker — nav, menu, theme, and transaction logic.
document.addEventListener("DOMContentLoaded", () => {
  // ===== Constants =====
  // Distinct, color-blind-friendly palette for chart slices. Cycles if needed.
  const CATEGORY_PALETTE = [
    "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed",
    "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5",
    "#0ea5e9", "#9333ea",
  ];
  let expenseChart = null; // Chart.js instance, lazily created

  // ===== Data layer =====
  const TXN_KEY = "expense-tracker:transactions";
  const CAT_KEY = "expense-tracker:categories";

  const loadJson = (key, fallback) => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch { return fallback; }
  };
  const loadTxns = () => loadJson(TXN_KEY, []);
  const loadCats = () => loadJson(CAT_KEY, null);
  const saveTxns = (list) => localStorage.setItem(TXN_KEY, JSON.stringify(list));
  const saveCats = (list) => localStorage.setItem(CAT_KEY, JSON.stringify(list));

  // Seed categories on first run
  const SEED_INCOME = ["Salary", "Freelance", "Investment", "Other Income"];
  const SEED_EXPENSE = ["Food", "Transport", "Bills", "Shopping", "Health", "Entertainment", "Other"];
  const slugify = (s) => s.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const seedId = (type, name) => `cat-${type}-${slugify(name)}`;

  const seedCategories = () => {
    const now = Date.now();
    return [
      ...SEED_INCOME.map((n, i) => ({ id: seedId("income", n), name: n, type: "income", createdAt: now + i })),
      ...SEED_EXPENSE.map((n, i) => ({ id: seedId("expense", n), name: n, type: "expense", createdAt: now + 100 + i })),
    ];
  };

  let categories = loadCats();
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    categories = seedCategories();
    saveCats(categories);
  }

  let transactions = loadTxns();

  // One-time migration: convert legacy string categories to category ids
  const fallbackId = (type) => seedId(type, type === "income" ? "Other Income" : "Other");
  const looksLikeOldCategory = (val) => typeof val === "string" && !val.startsWith("cat-");
  let migrated = false;
  transactions = transactions.map((t) => {
    if (!looksLikeOldCategory(t.category)) return t;
    // try matching seed by lowercase name
    const target = categories.find(
      (c) => c.type === t.type && (c.name.toLowerCase() === t.category.toLowerCase() || slugify(c.name) === slugify(t.category))
    );
    migrated = true;
    return { ...t, category: target ? target.id : fallbackId(t.type) };
  });
  if (migrated) saveTxns(transactions);

  // ===== Formatting =====
  const inr = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
  const formatAmount = (n) => inr.format(n);
  const formatDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  };
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const categoryById = (id) => categories.find((c) => c.id === id);
  const categoryName = (id) => {
    const c = categoryById(id);
    return c ? c.name : "Uncategorized";
  };
  const isSeedOther = (cat) =>
    cat && (cat.id === seedId("income", "Other Income") || cat.id === seedId("expense", "Other"));

  // ===== Render =====
  const recentTbody = document.getElementById("recent-tbody");
  const allTbody = document.getElementById("all-tbody");
  const countLabel = document.getElementById("count-label");
  const sumBalanceEl = document.getElementById("sum-balance");
  const sumIncomeEl = document.getElementById("sum-income");
  const sumExpenseEl = document.getElementById("sum-expense");
  const sumOpeningEl = document.getElementById("sum-opening");
  const sumOpeningHintEl = document.getElementById("sum-opening-hint");

  const emptyRow = (msg) =>
    `<tr class="txn-table__empty"><td colspan="6">${msg}</td></tr>`;

  const escapeHtml = (s) =>
    s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);

  const rowHtml = (t) => {
    const isIncome = t.type === "income";
    const sign = isIncome ? "+" : "-";
    const cls = isIncome ? "amount--income" : "amount--expense";
    const pill = isIncome ? "pill--income" : "pill--expense";
    const note = t.note ? escapeHtml(t.note) : "—";
    return `
      <tr data-id="${t.id}">
        <td data-label="Date">${formatDate(t.date)}</td>
        <td data-label="Category">${escapeHtml(categoryName(t.category))}</td>
        <td data-label="Note">${note}</td>
        <td data-label="Type"><span class="pill ${pill}">${capitalize(t.type)}</span></td>
        <td data-label="Amount" class="num amount ${cls}">${sign}${formatAmount(t.amount)}</td>
        <td class="row-actions">
          <button type="button" class="icon-btn" data-action="delete" aria-label="Delete transaction">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>
            </svg>
          </button>
        </td>
      </tr>`;
  };

  const sortedDesc = () =>
    [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

  const isCurrentMonth = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  };

  // True if the transaction is dated strictly before the 1st of the current month.
  // Used to compute opening balance (carry-forward from prior months).
  const isBeforeCurrentMonth = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return false;
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return d < firstOfMonth;
  };

  const monthLabel = (date) =>
    date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  // ===== Month-key helpers (used by chart + filter) =====
  const pad2 = (n) => String(n).padStart(2, "0");
  const monthKey = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  };
  const currentMonthKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  };
  const monthDisplayLabel = (key) => {
    if (key === "all") return "All months";
    const [y, m] = key.split("-").map(Number);
    return monthLabel(new Date(y, m - 1, 1));
  };
  const inMonth = (iso, key) => {
    if (key === "all") return true;
    return monthKey(iso) === key;
  };

  const render = () => {
    const list = sortedDesc();

    // Totals:
    //   opening balance = net of all transactions before the 1st of current month (b/f)
    //   income/expense  = this month only
    //   closing balance = opening + monthIncome - monthExpense (== all-time net)
    let monthIncome = 0, monthExpense = 0;
    let openingBalance = 0;
    for (const t of transactions) {
      const signed = t.type === "income" ? t.amount : -t.amount;
      if (isBeforeCurrentMonth(t.date)) {
        openingBalance += signed;
      } else if (isCurrentMonth(t.date)) {
        if (t.type === "income") monthIncome += t.amount;
        else monthExpense += t.amount;
      }
      // Future-dated transactions are excluded from opening/month but still render in lists.
    }
    const closingBalance = openingBalance + monthIncome - monthExpense;

    sumOpeningEl.textContent = formatAmount(openingBalance);
    sumOpeningHintEl.textContent = `Brought forward to ${monthLabel(new Date())}`;
    sumIncomeEl.textContent = formatAmount(monthIncome);
    sumExpenseEl.textContent = formatAmount(monthExpense);
    sumBalanceEl.textContent = formatAmount(closingBalance);

    // Tables — Recent (filtered), All (unfiltered)
    populateHomeFilters();
    const filtered = applyHomeFilters(list);
    if (filtered.length === 0) {
      recentTbody.innerHTML = emptyRow(
        list.length === 0
          ? "No transactions yet. Tap + to add your first one."
          : "No transactions match the selected filters."
      );
    } else {
      recentTbody.innerHTML = filtered.map(rowHtml).join("");
    }
    const reportsFiltered = applyReportsFilters(list);
    if (reportsFiltered.length === 0) {
      allTbody.innerHTML = emptyRow(
        list.length === 0 ? "No transactions to show." : "No transactions match the selected filters."
      );
    } else {
      allTbody.innerHTML = reportsFiltered.map(rowHtml).join("");
    }
    countLabel.textContent = `${reportsFiltered.length} ${reportsFiltered.length === 1 ? "entry" : "entries"}`;

    // Re-wire table interactions after innerHTML replacement
    wireTableInteractions();

    // Keep the Reports filter + chart in sync with current data
    populateMonthFilter();
    renderChart();
  };

  // ===== Home table filters =====
  const homeFilterMonth = document.getElementById("home-filter-month");
  const homeFilterType = document.getElementById("home-filter-type");
  const homeFilterCat = document.getElementById("home-filter-category");

  const populateHomeFilters = () => {
    // Month dropdown
    if (homeFilterMonth) {
      const prev = homeFilterMonth.value;
      const keys = new Set();
      for (const t of transactions) {
        const k = monthKey(t.date);
        if (k) keys.add(k);
      }
      keys.add(currentMonthKey());
      const sorted = [...keys].sort().reverse();
      homeFilterMonth.innerHTML =
        '<option value="all">All Months</option>' +
        sorted.map((k) => `<option value="${k}">${escapeHtml(monthDisplayLabel(k))}</option>`).join("");
      if (prev && (prev === "all" || sorted.includes(prev))) homeFilterMonth.value = prev;
    }

    // Category dropdown
    if (homeFilterCat) {
      const prev = homeFilterCat.value;
      const typeVal = homeFilterType ? homeFilterType.value : "all";
      const cats = categories
        .filter((c) => typeVal === "all" || c.type === typeVal)
        .sort((a, b) => a.name.localeCompare(b.name));
      homeFilterCat.innerHTML =
        '<option value="all">All Categories</option>' +
        cats.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
      if (prev && (prev === "all" || cats.some((c) => c.id === prev))) homeFilterCat.value = prev;
    }
  };

  const applyHomeFilters = (list) => {
    const m = homeFilterMonth ? homeFilterMonth.value : "all";
    const t = homeFilterType ? homeFilterType.value : "all";
    const c = homeFilterCat ? homeFilterCat.value : "all";
    return list.filter((txn) => {
      if (m !== "all" && monthKey(txn.date) !== m) return false;
      if (t !== "all" && txn.type !== t) return false;
      if (c !== "all" && txn.category !== c) return false;
      return true;
    });
  };

  // Re-render table when any home filter changes
  [homeFilterMonth, homeFilterType, homeFilterCat].forEach((el) => {
    if (el) el.addEventListener("change", () => {
      if (el === homeFilterType) {
        if (homeFilterCat) homeFilterCat.value = "all";
      }
      render();
    });
  });

  // ===== Reports table filter (month only) =====
  const applyReportsFilters = (list) => {
    const m = filterMonthEl ? filterMonthEl.value : "all";
    return list.filter((txn) => m === "all" || monthKey(txn.date) === m);
  };

  // ===== Reports: month filter + expense pie chart =====
  const filterMonthEl = document.getElementById("filter-month");
  const chartCanvas = document.getElementById("expense-pie");
  const chartEmptyEl = document.getElementById("chart-empty");
  const chartCaptionEl = document.getElementById("chart-caption");

  const populateMonthFilter = () => {
    if (!filterMonthEl) return;
    const keys = new Set();
    for (const t of transactions) {
      const k = monthKey(t.date);
      if (k) keys.add(k);
    }
    keys.add(currentMonthKey()); // always offer current month
    const sorted = [...keys].sort().reverse(); // desc
    const options = [...sorted, "all"];

    const previous = filterMonthEl.value;
    filterMonthEl.innerHTML = options
      .map((k) => `<option value="${k}">${escapeHtml(monthDisplayLabel(k))}</option>`)
      .join("");
    if (previous && options.includes(previous)) {
      filterMonthEl.value = previous;
    } else {
      filterMonthEl.value = currentMonthKey();
    }
  };

  const computeExpenseBreakdown = (key) => {
    const totals = new Map(); // categoryId -> sum
    for (const t of transactions) {
      if (t.type !== "expense") continue;
      if (!inMonth(t.date, key)) continue;
      totals.set(t.category, (totals.get(t.category) || 0) + t.amount);
    }
    const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    return {
      labels: entries.map(([id]) => categoryName(id)),
      values: entries.map(([, v]) => v),
      colors: entries.map((_, i) => CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]),
    };
  };

  const renderChart = () => {
    if (!chartCanvas || typeof Chart === "undefined") return;
    const key = filterMonthEl ? filterMonthEl.value || currentMonthKey() : currentMonthKey();
    const { labels, values, colors } = computeExpenseBreakdown(key);
    const total = values.reduce((s, v) => s + v, 0);

    if (chartCaptionEl) {
      chartCaptionEl.textContent = values.length
        ? `${monthDisplayLabel(key)} · ${formatAmount(total)}`
        : monthDisplayLabel(key);
    }

    if (values.length === 0) {
      chartCanvas.hidden = true;
      if (chartEmptyEl) chartEmptyEl.hidden = false;
      if (expenseChart) { expenseChart.destroy(); expenseChart = null; }
      return;
    }

    chartCanvas.hidden = false;
    if (chartEmptyEl) chartEmptyEl.hidden = true;

    if (expenseChart) {
      expenseChart.data.labels = labels;
      expenseChart.data.datasets[0].data = values;
      expenseChart.data.datasets[0].backgroundColor = colors;
      expenseChart.update();
      return;
    }

    expenseChart = new Chart(chartCanvas.getContext("2d"), {
      type: "pie",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: "#ffffff",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${formatAmount(ctx.parsed)}`,
            },
          },
        },
      },
      plugins: [{
        id: "sliceLabels",
        afterDraw(chart) {
          const { ctx: c } = chart;
          const dataset = chart.data.datasets[0];
          const meta = chart.getDatasetMeta(0);
          const total = dataset.data.reduce((s, v) => s + v, 0);
          if (!total) return;
          c.save();
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillStyle = "#fff";
          c.font = "600 13px -apple-system, BlinkMacSystemFont, sans-serif";
          meta.data.forEach((arc, i) => {
            const pct = ((dataset.data[i] / total) * 100).toFixed(0);
            if (pct < 5) return; // skip tiny slices
            const { x, y } = arc.tooltipPosition();
            c.fillText(`${pct}%`, x, y);
          });
          c.restore();
        },
      }],
    });
  };

  if (filterMonthEl) {
    filterMonthEl.addEventListener("change", render);
  }

  // ===== PDF export =====
  // jsPDF's built-in fonts lack the ₹ glyph, so we use "Rs." in the PDF.
  const formatPdf = (n) => {
    const abs = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
    return (n < 0 ? "-" : "") + "Rs. " + abs;
  };

  const exportPDF = () => {
    if (typeof window.jspdf === "undefined") {
      alert("PDF library not loaded. Check your internet connection and try again.");
      return;
    }
    const key = filterMonthEl ? filterMonthEl.value || currentMonthKey() : currentMonthKey();
    const label = monthDisplayLabel(key);

    // Filter + sort transactions for selected period
    const filtered = [...transactions]
      .filter((t) => inMonth(t.date, key))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

    // Compute financials
    let openingBalance = 0;
    if (key !== "all") {
      const [y, m] = key.split("-").map(Number);
      const firstOfMonth = new Date(y, m - 1, 1);
      for (const t of transactions) {
        const d = new Date(t.date);
        if (!isNaN(d) && d < firstOfMonth) {
          openingBalance += t.type === "income" ? t.amount : -t.amount;
        }
      }
    }
    let totalIncome = 0, totalExpense = 0;
    for (const t of filtered) {
      if (t.type === "income") totalIncome += t.amount;
      else totalExpense += t.amount;
    }
    const net = totalIncome - totalExpense;
    const closingBalance = openingBalance + net;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const PH = doc.internal.pageSize.getHeight();
    const LM = 14; // left margin
    let cy = 16;

    // ---- Header ----
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("Expense Tracker", LM, cy);
    cy += 7;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    doc.text(label, LM, cy);
    cy += 5;

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.4);
    doc.line(LM, cy, W - LM, cy);
    cy += 6;
    doc.setTextColor(0, 0, 0);

    // ---- Opening balance (specific month only) ----
    if (key !== "all") {
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(80, 80, 80);
      doc.text("Opening Balance (b/f)", LM, cy);
      doc.text(formatPdf(openingBalance), W - LM, cy, { align: "right" });
      cy += 8;
      doc.setTextColor(0, 0, 0);
    }

    // ---- Transaction table ----
    const tableBody = filtered.length
      ? filtered.map((t) => [
          formatDate(t.date),
          categoryName(t.category),
          t.note || "\u2014",
          t.type === "income" ? "Income" : "Expense",
          (t.type === "income" ? "+" : "-") + formatPdf(t.amount),
        ])
      : [["", "", "No transactions in this period", "", ""]];

    doc.autoTable({
      startY: cy,
      head: [["Date", "Category", "Note", "Type", "Amount"]],
      body: tableBody,
      styles: { fontSize: 9, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 20 },
        1: { cellWidth: 34 },
        2: { cellWidth: "auto" },
        3: { cellWidth: 24 },
        4: { cellWidth: 34, halign: "right" },
      },
      alternateRowStyles: { fillColor: [245, 247, 251] },
      margin: { left: LM, right: LM },
    });

    cy = doc.lastAutoTable.finalY + 10;

    // Ensure totals fit on current page; if too close to bottom, add new page
    if (cy > PH - 50) { doc.addPage(); cy = 20; }

    // ---- Totals ----
    doc.setLineWidth(0.4);
    doc.setDrawColor(220, 220, 220);
    doc.line(LM, cy - 2, W - LM, cy - 2);
    cy += 2;

    const totalRow = (label2, value, bold = false, color = [0, 0, 0]) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(10);
      doc.setTextColor(...color);
      doc.text(label2, LM, cy);
      doc.text(value, W - LM, cy, { align: "right" });
      doc.setTextColor(0, 0, 0);
      cy += 7;
    };

    totalRow("Total Income", formatPdf(totalIncome), false, [22, 163, 74]);
    totalRow("Total Expense", formatPdf(totalExpense), false, [220, 38, 38]);
    totalRow("Net", formatPdf(net), true);

    doc.setDrawColor(180, 180, 180);
    doc.line(LM, cy - 3, W - LM, cy - 3);
    cy += 1;
    totalRow("Closing Balance", formatPdf(closingBalance), true);

    // ---- Footer ----
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    const stamp = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    doc.text(`Generated on ${stamp}`, W - LM, PH - 10, { align: "right" });

    const filename = key === "all"
      ? "expense-tracker-all.pdf"
      : `expense-tracker-${key}.pdf`;
    doc.save(filename);
  };

  const exportBtn = document.getElementById("export-pdf-btn");
  if (exportBtn) exportBtn.addEventListener("click", exportPDF);

  // ===== Excel export =====
  const exportExcel = () => {
    if (typeof XLSX === "undefined") {
      alert("Excel library is still loading. Please try again.");
      return;
    }
    const key = filterMonthEl ? filterMonthEl.value : "all";
    const filtered = [...transactions]
      .filter((t) => inMonth(t.date, key))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

    // Compute totals
    let totalIncome = 0, totalExpense = 0;
    let openingBal = 0;
    if (key !== "all") {
      for (const t of transactions) {
        const [y, m] = key.split("-").map(Number);
        const first = new Date(y, m - 1, 1);
        const d = new Date(t.date);
        if (d < first) openingBal += t.type === "income" ? t.amount : -t.amount;
      }
    }
    for (const t of filtered) {
      if (t.type === "income") totalIncome += t.amount;
      else totalExpense += t.amount;
    }
    const net = totalIncome - totalExpense;
    const closingBal = openingBal + net;

    // Build rows
    const rows = [];
    const title = key === "all" ? "All Months" : monthDisplayLabel(key);
    rows.push(["Expense Tracker — " + title]);
    rows.push([]);

    if (key !== "all") {
      rows.push(["Opening Balance (b/f)", "", "", "", openingBal]);
      rows.push([]);
    }

    rows.push(["Date", "Category", "Note", "Type", "Amount"]);
    if (filtered.length === 0) {
      rows.push(["", "", "No transactions in this period", "", ""]);
    } else {
      for (const t of filtered) {
        rows.push([
          t.date,
          categoryName(t.category),
          t.note || "",
          capitalize(t.type),
          t.type === "income" ? t.amount : -t.amount,
        ]);
      }
    }

    rows.push([]);
    rows.push(["Total Income", "", "", "", totalIncome]);
    rows.push(["Total Expense", "", "", "", -totalExpense]);
    rows.push(["Net", "", "", "", net]);
    rows.push(["Closing Balance", "", "", "", closingBal]);

    // Create workbook
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Column widths
    ws["!cols"] = [
      { wch: 14 }, // Date
      { wch: 18 }, // Category
      { wch: 30 }, // Note
      { wch: 10 }, // Type
      { wch: 16 }, // Amount
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");

    const filename = key === "all"
      ? "expense-tracker-all.xlsx"
      : `expense-tracker-${key}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  const excelBtn = document.getElementById("export-excel-btn");
  if (excelBtn) excelBtn.addEventListener("click", exportExcel);

  // ===== Table interactions: click row = edit, click × = delete =====
  const wireTableInteractions = () => {
    [recentTbody, allTbody].forEach((tbody) => {
      tbody.querySelectorAll("tr[data-id]").forEach((tr) => {
        tr.addEventListener("click", (e) => {
          const delBtn = e.target.closest('[data-action="delete"]');
          const id = tr.dataset.id;
          if (delBtn) {
            e.stopPropagation();
            const t = transactions.find((x) => x.id === id);
            const label = t ? `${capitalize(t.type)} of ${formatAmount(t.amount)}` : "this transaction";
            if (confirm(`Delete ${label}?`)) {
              transactions = transactions.filter((x) => x.id !== id);
              saveTxns(transactions);
              if (editingId === id) exitEditMode();
              render();
            }
            return;
          }
          beginEdit(id);
        });
      });
    });
  };

  // ===== Category select on Add Transaction form =====
  const categorySelect = () => document.getElementById("category");
  const currentTypeRadio = () =>
    (document.querySelector('input[name="type"]:checked') || {}).value || "income";

  const renderCategorySelect = (preserveValue) => {
    const select = categorySelect();
    if (!select) return;
    const currentType = currentTypeRadio();
    const desired = preserveValue || select.value;
    const options = categories
      .filter((c) => c.type === currentType)
      .sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML = options
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join("");
    if (desired && options.some((c) => c.id === desired)) {
      select.value = desired;
    }
  };

  // Rebuild category options whenever Type changes
  document.querySelectorAll('input[name="type"]').forEach((r) => {
    r.addEventListener("change", () => renderCategorySelect());
  });
  renderCategorySelect();

  // ===== Categories view =====
  const catIncomeList = document.getElementById("cat-income-list");
  const catExpenseList = document.getElementById("cat-expense-list");
  const catIncomeCount = document.getElementById("cat-income-count");
  const catExpenseCount = document.getElementById("cat-expense-count");
  const catForm = document.getElementById("cat-form");
  const catFormTitle = document.getElementById("cat-form-title");
  const catNameInput = document.getElementById("cat-name");
  const catAddBtn = document.getElementById("cat-add-btn");
  let editingCatId = null;

  const usageCount = (catId) =>
    transactions.reduce((n, t) => (t.category === catId ? n + 1 : n), 0);

  const catRowHtml = (c) => {
    const seedOther = isSeedOther(c);
    return `
      <li class="category-list__item" data-cat-id="${c.id}">
        <span class="category-list__name">
          <span class="category-list__dot category-list__dot--${c.type}"></span>
          ${escapeHtml(c.name)}
        </span>
        <span class="category-list__actions">
          <button type="button" class="icon-btn icon-btn--edit" data-action="edit-cat" aria-label="Edit ${escapeHtml(c.name)}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button type="button" class="icon-btn" data-action="delete-cat" aria-label="Delete ${escapeHtml(c.name)}" ${seedOther ? "disabled title=\"Default category can't be deleted\"" : ""}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>
            </svg>
          </button>
        </span>
      </li>`;
  };

  const renderCategoriesView = () => {
    const inc = categories.filter((c) => c.type === "income").sort((a, b) => a.name.localeCompare(b.name));
    const exp = categories.filter((c) => c.type === "expense").sort((a, b) => a.name.localeCompare(b.name));
    catIncomeList.innerHTML = inc.length
      ? inc.map(catRowHtml).join("")
      : `<li class="category-list__empty">No income categories.</li>`;
    catExpenseList.innerHTML = exp.length
      ? exp.map(catRowHtml).join("")
      : `<li class="category-list__empty">No expense categories.</li>`;
    catIncomeCount.textContent = `${inc.length}`;
    catExpenseCount.textContent = `${exp.length}`;
    wireCategoryActions();
  };

  const openCatForm = (cat) => {
    editingCatId = cat ? cat.id : null;
    catFormTitle.textContent = cat ? "Edit Category" : "New Category";
    catNameInput.value = cat ? cat.name : "";
    const type = cat ? cat.type : "expense";
    const radio = catForm.querySelector(`input[name="cat-type"][value="${type}"]`);
    if (radio) radio.checked = true;
    // Disable type change for seed-other categories (they're the migration fallback)
    const typeRadios = catForm.querySelectorAll('input[name="cat-type"]');
    typeRadios.forEach((r) => (r.disabled = !!(cat && isSeedOther(cat))));
    catForm.hidden = false;
    catNameInput.focus();
  };
  const closeCatForm = () => {
    editingCatId = null;
    catForm.hidden = true;
    catForm.reset();
  };

  const wireCategoryActions = () => {
    [catIncomeList, catExpenseList].forEach((ul) => {
      ul.querySelectorAll("[data-cat-id]").forEach((li) => {
        const id = li.dataset.catId;
        const cat = categoryById(id);
        if (!cat) return;
        li.querySelector('[data-action="edit-cat"]').addEventListener("click", () => openCatForm(cat));
        const delBtn = li.querySelector('[data-action="delete-cat"]');
        if (!delBtn.disabled) {
          delBtn.addEventListener("click", () => deleteCategory(id));
        }
      });
    });
  };

  const deleteCategory = (id) => {
    const cat = categoryById(id);
    if (!cat || isSeedOther(cat)) return;
    const count = usageCount(id);
    const fallback = fallbackId(cat.type);
    const fallbackName = categoryName(fallback);
    const msg = count > 0
      ? `Delete "${cat.name}"?\n\n${count} transaction${count === 1 ? "" : "s"} will be reassigned to "${fallbackName}".`
      : `Delete "${cat.name}"?`;
    if (!confirm(msg)) return;
    if (count > 0) {
      transactions = transactions.map((t) => (t.category === id ? { ...t, category: fallback } : t));
      saveTxns(transactions);
    }
    categories = categories.filter((c) => c.id !== id);
    saveCats(categories);
    renderCategoriesView();
    renderCategorySelect();
    render();
  };

  catAddBtn.addEventListener("click", () => openCatForm(null));

  catForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = catNameInput.value.trim();
    if (!name) { catNameInput.focus(); return; }
    const data = new FormData(catForm);
    const type = data.get("cat-type") || "expense";

    if (editingCatId) {
      const existing = categoryById(editingCatId);
      // Prevent type-flip on seed-other categories
      const newType = existing && isSeedOther(existing) ? existing.type : type;
      categories = categories.map((c) =>
        c.id === editingCatId ? { ...c, name, type: newType, updatedAt: Date.now() } : c
      );
    } else {
      // Avoid duplicate name within same type
      const dup = categories.find((c) => c.type === type && c.name.toLowerCase() === name.toLowerCase());
      if (dup) {
        alert(`A "${type}" category named "${dup.name}" already exists.`);
        return;
      }
      categories.push({
        id: `cat-${type}-${slugify(name)}-${Date.now().toString(36)}`,
        name, type, createdAt: Date.now(),
      });
    }
    saveCats(categories);
    closeCatForm();
    renderCategoriesView();
    renderCategorySelect();
    render();
  });

  catForm.addEventListener("reset", () => setTimeout(closeCatForm, 0));

  renderCategoriesView();

  render();

  // ===== Add / Edit transaction form =====
  const form = document.getElementById("txn-form");
  const dateInput = document.getElementById("date");
  const addTitle = document.getElementById("add-title");
  const addSubtitle = document.getElementById("add-subtitle");
  const submitBtn = form.querySelector('button[type="submit"]');
  const cancelBtn = form.querySelector('button[type="reset"]');

  let editingId = null;
  const today = () => new Date().toISOString().slice(0, 10);

  if (dateInput && !dateInput.value) dateInput.value = today();

  const enterEditMode = () => {
    addTitle.textContent = "Edit Transaction";
    addSubtitle.textContent = "Update the details below, then save.";
    addSubtitle.classList.add("is-editing");
    submitBtn.textContent = "Save Changes";
    cancelBtn.textContent = "Cancel Edit";
  };
  const exitEditMode = () => {
    editingId = null;
    userManuallyChangedCategory = false;
    addTitle.textContent = "Add Transaction";
    addSubtitle.textContent = "Record an income or expense.";
    addSubtitle.classList.remove("is-editing");
    submitBtn.textContent = "Add Transaction";
    cancelBtn.textContent = "Cancel";
  };

  const beginEdit = (id) => {
    const t = transactions.find((x) => x.id === id);
    if (!t) return;
    editingId = id;
    form.querySelector(`input[name="type"][value="${t.type}"]`).checked = true;
    renderCategorySelect(t.category);
    form.querySelector('input[name="amount"]').value = t.amount;
    form.querySelector('input[name="date"]').value = t.date;
    form.querySelector('input[name="note"]').value = t.note || "";
    enterEditMode();
    setActive("add");
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const amount = parseFloat(data.get("amount"));
    if (!isFinite(amount) || amount <= 0) {
      document.getElementById("amount").focus();
      return;
    }
    const fields = {
      type: data.get("type"),
      amount,
      category: data.get("category"),
      date: data.get("date") || today(),
      note: (data.get("note") || "").toString().trim(),
    };

    if (editingId) {
      transactions = transactions.map((t) =>
        t.id === editingId ? { ...t, ...fields, updatedAt: Date.now() } : t
      );
    } else {
      transactions.push({
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
        ...fields,
        createdAt: Date.now(),
      });
    }
    saveTxns(transactions);
    render();
    const savedType = fields.type; // preserve type across reset
    form.reset();
    dateInput.value = today();
    exitEditMode();
    // Restore the same income/expense type for next entry
    const typeRadio = form.querySelector(`input[name="type"][value="${savedType}"]`);
    if (typeRadio) typeRadio.checked = true;
    renderCategorySelect();
    // Defer focus so it wins over any browser post-reset focus behaviour
    requestAnimationFrame(() => document.getElementById("amount").focus());
  });

  form.addEventListener("reset", () => {
    setTimeout(() => {
      dateInput.value = today();
      renderCategorySelect();
      exitEditMode();
      hideSuggestions();
    }, 0);
  });

  // ===== Autocomplete: suggest category + amount from past notes =====
  const noteInput = document.getElementById("note");
  const amountInput = document.getElementById("amount");
  const acMenu = document.getElementById("note-suggestions");
  let acItems = [];
  let acIndex = -1;
  let acDebounce = null;

  const normalize = (s) => (s || "").toString().trim().toLowerCase().replace(/\s+/g, " ");

  const findSuggestions = (query, type) => {
    const q = normalize(query);
    if (!q) return [];
    // Filter, then dedupe by normalized note (keep most recent), then take top 5
    const candidates = transactions
      .filter((t) => t.type === type && t.note && normalize(t.note).includes(q))
      .sort((a, b) => {
        const exactA = normalize(a.note) === q ? 1 : 0;
        const exactB = normalize(b.note) === q ? 1 : 0;
        if (exactA !== exactB) return exactB - exactA;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
    const seen = new Set();
    const out = [];
    for (const t of candidates) {
      const key = normalize(t.note);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= 5) break;
    }
    return out;
  };

  const highlightMatch = (text, query) => {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return safe;
    return (
      escapeHtml(text.slice(0, idx)) +
      "<mark>" + escapeHtml(text.slice(idx, idx + query.length)) + "</mark>" +
      escapeHtml(text.slice(idx + query.length))
    );
  };

  const renderSuggestions = (items, query) => {
    if (!items.length) { hideSuggestions(); return; }
    acItems = items;
    acIndex = -1;
    acMenu.innerHTML = items
      .map((t, i) => `
        <li class="autocomplete__item" role="option" id="ac-opt-${i}" data-i="${i}">
          <span class="autocomplete__item-main">
            <span class="autocomplete__item-note">${highlightMatch(t.note, query)}</span>
            <span class="autocomplete__item-cat">${escapeHtml(categoryName(t.category))}</span>
          </span>
          <span class="autocomplete__item-amount">${formatAmount(t.amount)}</span>
        </li>
      `).join("");
    acMenu.hidden = false;
    noteInput.setAttribute("aria-expanded", "true");

    acMenu.querySelectorAll(".autocomplete__item").forEach((li) => {
      li.addEventListener("mousedown", (e) => {
        // mousedown so it fires before blur
        e.preventDefault();
        applySuggestion(parseInt(li.dataset.i, 10));
      });
    });
  };

  const hideSuggestions = () => {
    acMenu.hidden = true;
    acMenu.innerHTML = "";
    acItems = [];
    acIndex = -1;
    noteInput.setAttribute("aria-expanded", "false");
    noteInput.removeAttribute("aria-activedescendant");
  };

  const setActiveSuggestion = (i) => {
    acIndex = i;
    acMenu.querySelectorAll(".autocomplete__item").forEach((li, idx) => {
      li.classList.toggle("is-active", idx === i);
    });
    noteInput.setAttribute("aria-activedescendant", i >= 0 ? `ac-opt-${i}` : "");
  };

  const applySuggestion = (i) => {
    const t = acItems[i];
    if (!t) return;
    // Set type if it doesn't already match (it should, since we filtered)
    const typeRadio = form.querySelector(`input[name="type"][value="${t.type}"]`);
    if (typeRadio && !typeRadio.checked) {
      typeRadio.checked = true;
      renderCategorySelect(t.category);
    } else {
      // Make sure category select includes the desired option
      const select = categorySelect();
      if (select && ![...select.options].some((o) => o.value === t.category)) {
        renderCategorySelect(t.category);
      } else if (select) {
        select.value = t.category;
      }
    }
    noteInput.value = t.note;
    hideSuggestions();
    amountInput.focus();
  };

  noteInput.addEventListener("input", () => {
    clearTimeout(acDebounce);
    acDebounce = setTimeout(() => {
      const q = noteInput.value;
      if (!q.trim()) { hideSuggestions(); return; }
      const items = findSuggestions(q, currentTypeRadio());
      renderSuggestions(items, q.trim());
    }, 120);
  });

  noteInput.addEventListener("focus", () => {
    const q = noteInput.value;
    if (!q.trim()) return;
    const items = findSuggestions(q, currentTypeRadio());
    renderSuggestions(items, q.trim());
  });

  noteInput.addEventListener("blur", () => {
    // Delay so click on item still registers (mousedown handler fires first anyway)
    setTimeout(hideSuggestions, 120);
  });

  noteInput.addEventListener("keydown", (e) => {
    if (acMenu.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestion(Math.min(acIndex + 1, acItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion(Math.max(acIndex - 1, 0));
    } else if (e.key === "Enter") {
      if (acIndex >= 0) {
        e.preventDefault();
        applySuggestion(acIndex);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      hideSuggestions();
    }
  });

  // Hide suggestions if Type changes mid-flight (results would be stale)
  document.querySelectorAll('input[name="type"]').forEach((r) => {
    r.addEventListener("change", hideSuggestions);
  });

  // ===== Smart categorization: keyword mapping + learned predictions =====
  const smartSuggestEl = document.getElementById("smart-suggest");
  let userManuallyChangedCategory = false; // guard against overriding user choice
  let lastSmartSuggestion = null; // { type, categoryId, categoryName, confidence }

  // Listen for manual category/type changes to set the guard
  if (categorySelect()) {
    categorySelect().addEventListener("change", () => { userManuallyChangedCategory = true; });
  }
  document.querySelectorAll('input[name="type"]').forEach((r) => {
    r.addEventListener("change", () => { userManuallyChangedCategory = true; });
  });

  // Reset guard when form resets or new transaction started
  const resetSmartGuard = () => {
    userManuallyChangedCategory = false;
    lastSmartSuggestion = null;
    if (smartSuggestEl) smartSuggestEl.hidden = true;
  };

  // Keyword → category mappings — comprehensive metro-city bachelor life
  const KEYWORD_MAP = [
    // Transport & commute
    { keywords: ["uber", "ola", "taxi", "cab", "rapido", "auto", "rickshaw", "bmrcl", "metro", "bus", "namma", "yulu", "bounce", "vogo", "bike taxi"], category: "Transport", type: "expense" },
    // Travel & trips
    { keywords: ["ixigo", "flight", "hotel", "travel", "trip", "booking", "train", "irctc", "makemytrip", "goibibo", "cleartrip", "yatra", "oyo", "hostel", "airbnb", "indigo", "spicejet", "vistara", "air india"], category: "Transport", type: "expense" },
    // Food & dining out
    { keywords: ["swiggy", "zomato", "eatclub", "food", "restaurant", "lunch", "dinner", "cafe", "biryani", "pizza", "burger", "chai", "tea", "coffee", "ccd", "starbucks", "dominos", "mcdonalds", "kfc", "subway", "thali", "mess", "canteen", "tiffin", "breakfast", "snack", "bakery", "juice", "lassi", "dosa", "idli", "paratha", "momos", "maggi", "noodle", "ice cream", "dessert", "paan"], category: "Food", type: "expense" },
    // Groceries & home supplies
    { keywords: ["zepto", "blinkit", "bigbasket", "grofers", "dunzo", "jiomart", "dmart", "reliance", "grocery", "supermarket", "kirana", "vegetables", "fruits", "milk", "eggs", "bread", "rice", "dal", "oil", "atta", "soap", "shampoo", "detergent", "toilet", "tissue", "kitchen", "supplies", "household"], category: "Shopping", type: "expense" },
    // Online shopping
    { keywords: ["amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "croma", "reliance digital", "tatacliq", "snapdeal", "shop", "shopping", "mall", "clothing", "shoes", "electronics", "gadget", "mobile", "laptop", "headphone", "charger", "accessory"], category: "Shopping", type: "expense" },
    // Bills & utilities
    { keywords: ["electricity", "water", "gas", "internet", "wifi", "broadband", "jio", "airtel", "vi", "bsnl", "phone", "recharge", "rent", "bill", "emi", "loan", "insurance", "lic", "premium", "maintenance", "society", "piped gas", "cylinder", "dth", "tata sky", "act fibernet", "sbi", "bhim", "sbibhim"], category: "Bills", type: "expense" },
    // Entertainment & subscriptions
    { keywords: ["netflix", "spotify", "hotstar", "prime", "disney", "youtube", "apple music", "jio cinema", "sonyliv", "zee5", "movie", "cinema", "pvr", "inox", "multiplex", "concert", "event", "game", "gaming", "steam", "playstation", "xbox", "book", "kindle", "audible", "gym", "fitness", "cult", "curefit"], category: "Entertainment", type: "expense" },
    // Health & medical
    { keywords: ["medicine", "doctor", "hospital", "pharmacy", "medical", "clinic", "health", "lab", "test", "apollo", "medplus", "netmeds", "pharmeasy", "1mg", "practo", "dental", "eye", "vaccine", "blood test", "x-ray", "scan"], category: "Health", type: "expense" },
    // Income
    { keywords: ["salary", "bonus", "stipend", "payroll", "income", "wages", "neft", "credited"], category: "Salary", type: "income" },
    { keywords: ["freelance", "consulting", "gig", "contract", "project", "upwork", "fiverr"], category: "Freelance", type: "income" },
    { keywords: ["investment", "dividend", "interest", "mutual fund", "stock", "return", "fd", "rd", "ppf", "nps", "sip", "groww", "zerodha", "kuvera", "smallcase"], category: "Investment", type: "income" },
  ];

  // Find category id by name (case-insensitive) and type
  const findCategoryByName = (name, type) => {
    const n = name.toLowerCase();
    return categories.find((c) => c.type === type && c.name.toLowerCase() === n);
  };

  // PART 2: Learn from past transactions — frequency-based scoring
  const learnFromHistory = (noteText) => {
    const q = normalize(noteText);
    if (!q) return null;

    const scores = new Map(); // categoryId → { score, type, name }

    for (const t of transactions) {
      if (!t.note || !t.category) continue;
      const tn = normalize(t.note);
      let score = 0;

      // Exact match → highest
      if (tn === q) score = 10;
      // Starts with query → high
      else if (tn.startsWith(q)) score = 6;
      // Contains query → medium
      else if (tn.includes(q)) score = 3;
      // Query contains the transaction note → low
      else if (q.includes(tn) && tn.length > 2) score = 2;
      else continue;

      const key = t.category;
      const prev = scores.get(key) || { score: 0, count: 0, type: t.type };
      scores.set(key, {
        score: prev.score + score,
        count: prev.count + 1,
        type: t.type,
      });
    }

    if (scores.size === 0) return null;

    // Pick the highest scoring category
    let best = null;
    let bestScore = 0;
    for (const [catId, data] of scores) {
      // Boost by frequency
      const finalScore = data.score + data.count * 2;
      if (finalScore > bestScore) {
        bestScore = finalScore;
        best = { categoryId: catId, type: data.type, confidence: Math.min(finalScore / 20, 1) };
      }
    }

    return best;
  };

  // PART 1: Keyword-based fallback prediction
  const keywordPredict = (noteText) => {
    const q = normalize(noteText);
    if (!q) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (const entry of KEYWORD_MAP) {
      for (const kw of entry.keywords) {
        let score = 0;
        if (q === kw) score = 8;
        else if (q.includes(kw)) score = 5;
        else if (kw.includes(q) && q.length >= 3) score = 2;
        else continue;

        if (score > bestScore) {
          bestScore = score;
          const cat = findCategoryByName(entry.category, entry.type);
          if (cat) {
            bestMatch = {
              categoryId: cat.id,
              type: entry.type,
              confidence: Math.min(score / 8, 1),
            };
          }
        }
      }
    }
    return bestMatch;
  };

  // PART 3: Combined prediction
  const predictCategory = (noteText) => {
    // First: learn from history (higher trust)
    const learned = learnFromHistory(noteText);
    if (learned && learned.confidence >= 0.3) return learned;

    // Fallback: keyword mapping
    const keyword = keywordPredict(noteText);
    if (keyword) return keyword;

    // Return learned even if low confidence
    return learned;
  };

  // Show suggestion UI
  const showSmartSuggestion = (prediction) => {
    if (!smartSuggestEl || !prediction) {
      if (smartSuggestEl) smartSuggestEl.hidden = true;
      lastSmartSuggestion = null;
      return;
    }

    const catName = categoryName(prediction.categoryId);
    const typeName = capitalize(prediction.type);
    lastSmartSuggestion = { ...prediction, categoryName: catName };

    smartSuggestEl.innerHTML = `
      <svg class="smart-suggest__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17H8v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z"/><line x1="9" y1="21" x2="15" y2="21"/></svg>
      <span class="smart-suggest__text">Suggested: <strong>${escapeHtml(catName)}</strong> (${typeName})</span>
      <span class="smart-suggest__apply">Apply</span>
    `;
    smartSuggestEl.hidden = false;
  };

  // Apply the smart suggestion
  const applySmartSuggestion = () => {
    if (!lastSmartSuggestion) return;
    const { type, categoryId } = lastSmartSuggestion;

    // Set type
    const typeRadio = form.querySelector(`input[name="type"][value="${type}"]`);
    if (typeRadio && !typeRadio.checked) {
      typeRadio.checked = true;
      renderCategorySelect(categoryId);
    } else {
      const select = categorySelect();
      if (select) select.value = categoryId;
    }

    smartSuggestEl.hidden = true;
    userManuallyChangedCategory = true; // user accepted, don't override again
  };

  if (smartSuggestEl) {
    smartSuggestEl.addEventListener("click", applySmartSuggestion);
  }

  // Hook into note input — run prediction alongside autocomplete
  let smartDebounce = null;
  noteInput.addEventListener("input", () => {
    clearTimeout(smartDebounce);
    smartDebounce = setTimeout(() => {
      // Don't suggest if user manually changed category or is editing
      if (userManuallyChangedCategory || editingId) {
        if (smartSuggestEl) smartSuggestEl.hidden = true;
        return;
      }

      const q = noteInput.value.trim();
      if (!q || q.length < 2) {
        if (smartSuggestEl) smartSuggestEl.hidden = true;
        lastSmartSuggestion = null;
        return;
      }

      const prediction = predictCategory(q);
      if (prediction && prediction.confidence >= 0.5) {
        // High confidence: auto-apply silently
        const { type, categoryId } = prediction;
        const typeRadio = form.querySelector(`input[name="type"][value="${type}"]`);
        if (typeRadio && !typeRadio.checked) {
          typeRadio.checked = true;
          renderCategorySelect(categoryId);
        } else {
          const select = categorySelect();
          if (select) select.value = categoryId;
        }
        if (smartSuggestEl) smartSuggestEl.hidden = true;
      } else if (prediction) {
        // Low confidence: show suggestion, don't auto-apply
        showSmartSuggestion(prediction);
      } else {
        if (smartSuggestEl) smartSuggestEl.hidden = true;
        lastSmartSuggestion = null;
      }
    }, 200);
  });

  // Clear suggestion when note is emptied
  noteInput.addEventListener("blur", () => {
    setTimeout(() => {
      if (!noteInput.value.trim() && smartSuggestEl) smartSuggestEl.hidden = true;
    }, 150);
  });

  // Reset smart state on form reset and when beginning a new transaction
  form.addEventListener("reset", () => setTimeout(resetSmartGuard, 0));

  // ===== Focus trap: keep TAB cycling inside the Add Transaction form =====
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;

    // Build ordered list; collapse radio group to just the checked radio (or first)
    const candidates = Array.from(
      form.querySelectorAll("input:not([disabled]), select:not([disabled]), button:not([disabled])")
    );
    const focusable = candidates.filter((el) => {
      if (el.type === "radio") {
        const group = form.querySelectorAll(`input[name="${el.name}"]`);
        const checked = Array.from(group).find((r) => r.checked);
        return el === (checked || group[0]);
      }
      return true;
    });

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
      // Close autocomplete dropdown when tabbing away from note
      if (active === noteInput) hideSuggestions();
    }
  });

  // ===== Nav, theme, menu (below) =====
  // ----- Nav -----
  const views = document.querySelectorAll(".view");
  const navButtons = document.querySelectorAll("[data-target]");

  const staggerView = (view) => {
    // Collect animatable elements: direct children, but expand summary-grid into individual cards
    const items = [];
    for (const child of view.children) {
      if (child.classList.contains("summary-grid")) {
        for (const card of child.children) items.push(card);
      } else {
        items.push(child);
      }
    }
    items.forEach((el, i) => {
      el.classList.remove("anim-in");
      void el.offsetWidth; // force reflow to restart animation
      el.style.setProperty("--i", i);
      el.classList.add("anim-in");
    });
  };

  const setActive = (target) => {
    views.forEach((v) => v.classList.toggle("is-active", v.id === target));
    navButtons.forEach((b) => {
      if (b.dataset.target === target) {
        b.setAttribute("aria-current", "page");
      } else {
        b.removeAttribute("aria-current");
      }
    });
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    const activeView = document.getElementById(target);
    if (activeView) staggerView(activeView);
  };

  // Trigger stagger on initial page load (Home view)
  const initialView = document.querySelector(".view.is-active");
  if (initialView) staggerView(initialView);

  navButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const target = btn.dataset.target;
      if (!target) return;
      // Clicking the Add nav gives a fresh form, not an edit
      if (target === "add" && editingId) {
        form.reset();
        dateInput.value = today();
        exitEditMode();
      }
      setActive(target);
      // If the trigger lives inside the hamburger menu, close it
      if (menu && menu.contains(btn)) closeMenu();
    });
  });

  // ----- Theme -----
  const root = document.documentElement;
  const themeToggle = document.getElementById("theme-toggle");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

  const applyTheme = (theme) => {
    root.setAttribute("data-theme", theme);
    if (themeToggle) themeToggle.checked = theme === "dark";
  };

  const saved = localStorage.getItem("theme");
  applyTheme(saved || (prefersDark.matches ? "dark" : "light"));

  if (themeToggle) {
    themeToggle.addEventListener("change", () => {
      const next = themeToggle.checked ? "dark" : "light";
      applyTheme(next);
      localStorage.setItem("theme", next);
    });
  }

  // ----- Menu -----
  const menuBtn = document.getElementById("menu-toggle");
  const menu = document.getElementById("app-menu");

  const closeMenu = () => {
    if (!menu || menu.hasAttribute("hidden")) return;
    menu.setAttribute("hidden", "");
    menuBtn.setAttribute("aria-expanded", "false");
  };
  const openMenu = () => {
    if (!menu) return;
    menu.removeAttribute("hidden");
    menuBtn.setAttribute("aria-expanded", "true");
  };

  if (menuBtn && menu) {
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hasAttribute("hidden") ? openMenu() : closeMenu();
    });
    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target) && e.target !== menuBtn) closeMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
  }

  // Alt+1/2/3 shortcuts to switch views
  document.addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
    const map = { "1": "home", "2": "add", "3": "reports" };
    if (map[e.key]) {
      e.preventDefault();
      setActive(map[e.key]);
    }
  });

  // ===== Bank statement PDF import =====
  const stmtFileInput = document.getElementById("stmt-file-input");
  const importBtn = document.getElementById("import-stmt-btn");
  const importList = document.getElementById("import-list");
  const importCount = document.getElementById("import-count");
  const importSummary = document.getElementById("import-summary");
  const importSelectAll = document.getElementById("import-select-all");
  const importConfirmBtn = document.getElementById("import-confirm-btn");
  const importCancelBtn = document.getElementById("import-cancel-btn");

  let parsedTransactions = [];

  if (importBtn && stmtFileInput) {
    importBtn.addEventListener("click", () => {
      closeMenu();
      stmtFileInput.click();
    });

    stmtFileInput.addEventListener("change", async () => {
      const file = stmtFileInput.files[0];
      if (!file) return;
      stmtFileInput.value = ""; // allow re-selecting same file

      if (typeof pdfjsLib === "undefined") {
        alert("PDF library is still loading. Please try again in a moment.");
        return;
      }

      try {
        parsedTransactions = await parseStatementPDF(file);
        if (parsedTransactions.length === 0) {
          alert("No transactions found in this PDF. Make sure it's an SBI bank statement.");
          return;
        }
        renderImportReview();
        setActive("import-review");
      } catch (err) {
        console.error("PDF parse error:", err);
        alert("Could not parse the PDF. Make sure it's a valid SBI bank statement.");
      }
    });
  }

  async function parseStatementPDF(file) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let allText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item) => item.str);
      allText += strings.join(" ") + "\n";
    }

    return extractTransactions(allText);
  }

  function extractTransactions(text) {
    const results = [];
    // Match date pairs DD/MM/YYYY DD/MM/YYYY followed by transaction details
    // Then look for amounts: debit and/or credit
    const datePattern = /(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}\/\d{2}\/\d{4}/g;
    let match;
    const positions = [];

    while ((match = datePattern.exec(text)) !== null) {
      positions.push({
        index: match.index,
        day: match[1],
        month: match[2],
        year: match[3],
      });
    }

    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].index;
      const end = i + 1 < positions.length ? positions[i + 1].index : text.length;
      const chunk = text.slice(start, end);

      const { day, month, year } = positions[i];
      const isoDate = `${year}-${month}-${day}`;

      // Extract all amounts from chunk (Indian format: 1,00,000.00 or 100.00)
      const amountRegex = /[\d,]+\.\d{2}/g;
      const amounts = [];
      let amtMatch;
      while ((amtMatch = amountRegex.exec(chunk)) !== null) {
        const val = parseFloat(amtMatch[0].replace(/,/g, ""));
        if (val > 0) amounts.push(val);
      }

      // Determine type from keywords
      const isCredit = /DEP\s+TFR|UPI\/CR\//i.test(chunk);
      const isDebit = /WDL\s+TFR|UPI\/DR\//i.test(chunk);

      if (!isCredit && !isDebit) continue;
      if (amounts.length === 0) continue;

      // For debit: first amount is the debit, last is balance
      // For credit: the credit amount is usually followed by the balance
      // We need to identify which amount is the transaction amount vs balance
      let amount;
      if (isDebit && !isCredit) {
        // First amount is typically the debit amount
        amount = amounts[0];
      } else if (isCredit && !isDebit) {
        // For credit, the credit amount is before the balance
        // If there are 2 amounts, first is credit, second is balance
        amount = amounts[0];
      } else {
        // Both keywords present (rare) — skip
        continue;
      }

      // Extract name from UPI details
      const note = extractName(chunk);

      // Check for duplicates within parsed set
      const type = isCredit ? "income" : "expense";

      results.push({ date: isoDate, amount, type, note });
    }

    return results;
  }

  function extractName(chunk) {
    // Try UPI pattern: UPI/DR|CR/<ref>/<NAME>/BANK/...
    const upiMatch = chunk.match(/UPI\/(?:DR|CR)\/\d+\/([^\/]+)/);
    if (upiMatch) {
      let name = upiMatch[1].trim();
      // Clean up: title-case, remove trailing junk
      name = name.replace(/\s+/g, " ");
      // Title case
      name = name.split(" ").map((w) =>
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      ).join(" ");
      return name;
    }
    // Fallback: try to get something meaningful
    const lines = chunk.split(/\s+/);
    const tfrIdx = lines.findIndex((w) => w === "TFR");
    if (tfrIdx >= 0 && tfrIdx + 1 < lines.length) {
      return lines.slice(tfrIdx + 1, tfrIdx + 3).join(" ");
    }
    return "Bank transaction";
  }

  function renderImportReview() {
    let totalIncome = 0, totalExpense = 0, incomeCount = 0, expenseCount = 0;
    for (const t of parsedTransactions) {
      if (t.type === "income") { totalIncome += t.amount; incomeCount++; }
      else { totalExpense += t.amount; expenseCount++; }
    }

    importSummary.innerHTML = `
      <div class="import-summary__stat">
        <span class="import-summary__stat-label">Total Found</span>
        <span class="import-summary__stat-value">${parsedTransactions.length} transactions</span>
      </div>
      <div class="import-summary__stat">
        <span class="import-summary__stat-label">Income (${incomeCount})</span>
        <span class="import-summary__stat-value import-summary__stat-value--income">+${formatAmount(totalIncome)}</span>
      </div>
      <div class="import-summary__stat">
        <span class="import-summary__stat-label">Expenses (${expenseCount})</span>
        <span class="import-summary__stat-value import-summary__stat-value--expense">-${formatAmount(totalExpense)}</span>
      </div>
    `;

    importCount.textContent = `${parsedTransactions.length} transactions`;
    importSelectAll.checked = true;

    // Pre-build category option HTML for income and expense
    const catOptions = {};
    for (const type of ["income", "expense"]) {
      const cats = categories.filter((c) => c.type === type).sort((a, b) => a.name.localeCompare(b.name));
      catOptions[type] = cats.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
    }

    importList.innerHTML = parsedTransactions.map((t, i) => {
      const sign = t.type === "income" ? "+" : "-";
      const cls = t.type === "income" ? "import-row__amount--income" : "import-row__amount--expense";
      const dateStr = formatDate(t.date);
      return `
        <div class="import-row" data-row-idx="${i}">
          <input type="checkbox" data-import-idx="${i}" checked tabindex="0" />
          <div class="import-row__details">
            <div class="import-row__fields">
              <input type="text" class="import-row__note-input" data-note-idx="${i}" value="${escapeHtml(t.note)}" placeholder="Add a note..." tabindex="0" />
              <input type="number" class="import-row__amount-input" data-amt-idx="${i}" value="${t.amount}" min="0" step="0.01" tabindex="0" />
              <select class="import-row__cat-select" data-cat-idx="${i}" tabindex="0">${catOptions[t.type]}</select>
            </div>
            <span class="import-row__meta">${dateStr} · ${capitalize(t.type)} · <span class="import-row__original">was: ${escapeHtml(t.note)}</span></span>
          </div>
        </div>`;
    }).join("");

    // Smart-assign categories: use predictCategory, fallback to "Other"
    parsedTransactions.forEach((t, i) => {
      const select = importList.querySelector(`select[data-cat-idx="${i}"]`);
      if (!select) return;
      const fallback = t.type === "income" ? seedId("income", "Other Income") : seedId("expense", "Other");
      const prediction = predictCategory(t.note);
      if (prediction && prediction.categoryId && prediction.type === t.type) {
        // Only apply if the predicted category exists in the dropdown
        const hasOption = [...select.options].some((o) => o.value === prediction.categoryId);
        select.value = hasOption ? prediction.categoryId : fallback;
      } else {
        select.value = fallback;
      }
    });

    updateImportCount();
  }

  function updateImportCount() {
    const checked = importList.querySelectorAll('input[type="checkbox"]:checked').length;
    importCount.textContent = `${checked} of ${parsedTransactions.length} selected`;
  }

  if (importSelectAll) {
    importSelectAll.addEventListener("change", () => {
      const val = importSelectAll.checked;
      importList.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.checked = val);
      updateImportCount();
    });
  }

  if (importList) {
    importList.addEventListener("change", (e) => {
      if (e.target.type === "checkbox") updateImportCount();
    });
  }

  if (importConfirmBtn) {
    importConfirmBtn.addEventListener("click", () => {
      const checkboxes = importList.querySelectorAll('input[type="checkbox"]:checked');
      const fallbackExpense = seedId("expense", "Other");
      const fallbackIncome = seedId("income", "Other Income");
      let added = 0;

      checkboxes.forEach((cb) => {
        const idx = parseInt(cb.dataset.importIdx, 10);
        const t = parsedTransactions[idx];
        if (!t) return;

        // Read the edited note, amount and category from the row
        const noteEl = importList.querySelector(`input[data-note-idx="${idx}"]`);
        const amtEl = importList.querySelector(`input[data-amt-idx="${idx}"]`);
        const catEl = importList.querySelector(`select[data-cat-idx="${idx}"]`);
        const editedNote = noteEl ? noteEl.value.trim() : t.note;
        const editedAmount = amtEl ? Math.abs(parseFloat(amtEl.value) || t.amount) : t.amount;
        const chosenCat = catEl ? catEl.value : (t.type === "income" ? fallbackIncome : fallbackExpense);

        // Duplicate check: same date + amount + edited note
        const dup = transactions.some(
          (x) => x.date === t.date && Math.abs(x.amount - editedAmount) < 0.01 && x.note === editedNote
        );
        if (dup) return;

        transactions.push({
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random() + added),
          type: t.type,
          amount: editedAmount,
          category: chosenCat,
          date: t.date,
          note: editedNote,
          createdAt: Date.now() + added,
        });
        added++;
      });

      saveTxns(transactions);
      render();
      parsedTransactions = [];
      setActive("home");
      if (added > 0) {
        alert(`Imported ${added} transaction${added > 1 ? "s" : ""} successfully!`);
      } else {
        alert("No new transactions to import (duplicates were skipped).");
      }
    });
  }

  if (importCancelBtn) {
    importCancelBtn.addEventListener("click", () => {
      parsedTransactions = [];
      setActive("home");
    });
  }

  // Focus trap for import review: TAB cycles checkbox → note → category → next row
  const importSection = document.getElementById("import-review");
  if (importSection) {
    importSection.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        importSection.querySelectorAll('input[type="checkbox"], input[type="text"], select, button')
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first) { e.preventDefault(); last.focus(); }
      } else {
        if (active === last) { e.preventDefault(); first.focus(); }
      }
    });
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}
