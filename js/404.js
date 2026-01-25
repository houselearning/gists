// /js/404.js
// Minimal client logic for 404 page actions
document.getElementById("searchBtn").addEventListener("click", () => {
  const q = prompt("Search the site for:");
  if (!q) return;
  // simple redirect to forum search or site search page if you have one
  window.location.href = `https://houselearning.org/docs/forum.html?q=${encodeURIComponent(q)}`;
});

document.getElementById("reportBtn").addEventListener("click", async () => {
  const url = window.location.href;
  const reason = prompt("Report this broken link. Briefly describe what happened:");
  if (!reason) return;
  // If you have a reporting endpoint, call it. Otherwise show a copyable message.
  const reportText = `Broken link report\nURL: ${url}\nReason: ${reason}\nTime: ${new Date().toISOString()}`;
  try {
    await navigator.clipboard.writeText(reportText);
    const status = document.getElementById("reportStatus");
    status.textContent = "Report copied to clipboard. Paste it into an issue or send to the site admin.";
  } catch {
    alert("Copy this report and send it to the site admin:\n\n" + reportText);
  }
});
