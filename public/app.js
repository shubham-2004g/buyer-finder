const $ = (id) => document.getElementById(id);
let buyers = [];
const DEFAULT_SUBJECT = "Wholesale home decor for {{name}}";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function loadStatus() {
  try {
    const s = await (await fetch("/api/status")).json();
    $("chips").innerHTML = [["Google Places", s.google], ["Hunter.io", s.hunter], ["Email sender", s.mail]]
      .map(([n, ok]) => `<span class="chip ${ok ? "on" : "off"}">${n}: ${ok ? "connected" : "key missing"}</span>`).join("");
  } catch {
    $("chips").innerHTML = '<span class="chip off">Server not reachable</span>';
  }
}

function setState(html, cls = "") {
  $("state").className = "state " + cls;
  $("state").innerHTML = html;
}

async function search() {
  const location = $("location").value.trim();
  if (!location) return setState("Enter a US city or state to search.", "error");
  $("searchBtn").disabled = true;
  $("tbl").hidden = true;
  $("summary").textContent = "";
  setState('<span class="spin"></span>Finding businesses and their emails. This can take up to a minute.');
  try {
    const r = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: $("keyword").value, location, limit: $("limit").value }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Search failed");
    buyers = d.results;
    $("summary").textContent = `${d.total} businesses found, ${d.withEmail} with an email address.`;
    if (!d.total) return setState("No businesses found. Try a different business type or a bigger city.");
    setState(d.hunterError ? "Hunter.io said: " + esc(d.hunterError) : "", d.hunterError ? "warn" : "");
    render();
  } catch (e) {
    setState(esc(e.message), "error");
  } finally {
    $("searchBtn").disabled = false;
  }
}

const badge = (email) => (email ? '<span class="badge">Ready</span>' : "");
const picked = () => [...document.querySelectorAll("#rows input:checked")].map((c) => +c.dataset.i);

function updateCount() {
  const n = picked().length;
  $("sendBtn").disabled = !n;
  $("sendBtn").textContent = `Send to ${n} selected`;
}

function render() {
  $("tbl").hidden = false;
  $("selAll").checked = false;
  $("rows").innerHTML = buyers.map((b, i) => {
    let host = "";
    try { host = new URL(b.website).hostname.replace(/^www\./, ""); } catch {}
    return `
    <tr class="${b.email ? "" : "noemail"}">
      <td><input type="checkbox" data-i="${i}" ${b.email ? "" : "disabled"} aria-label="Select ${esc(b.name)}"></td>
      <td><div class="name">${esc(b.name)}</div>
          <div class="sub">${host ? `<a href="${esc(b.website)}" target="_blank" rel="noopener">${esc(host)}</a>` : "No website"}${b.phone ? " &middot; " + esc(b.phone) : ""}</div></td>
      <td>${b.email ? `<div>${esc(b.email)}</div><div class="sub">${esc(b.contact)}</div>` : '<span class="sub">No email found</span>'}</td>
      <td class="sub">${esc(b.address)}</td>
      <td id="st${i}">${badge(b.email)}</td>
    </tr>`;
  }).join("");
  updateCount();
}

document.addEventListener("change", (e) => {
  if (e.target.id === "selAll") {
    document.querySelectorAll("#rows input:not(:disabled)").forEach((c) => (c.checked = e.target.checked));
  }
  if (e.target.id === "selAll" || e.target.closest("#rows")) updateCount();
});

async function send() {
  const idx = picked();
  if (!idx.length || !confirm(`Send this email to ${idx.length} businesses?`)) return;
  $("sendBtn").disabled = true;
  $("sendBtn").textContent = "Sending...";
  idx.forEach((i) => ($("st" + i).innerHTML = '<span class="badge">Sending...</span>'));
  try {
    const r = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buyers: idx.map((i) => buyers[i]), subject: $("subject").value, body: $("body").value }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    d.forEach((x) => {
      const i = buyers.findIndex((b) => b.email === x.email);
      $("st" + i).innerHTML = `<span class="badge ${x.status}" title="${esc(x.error || "")}">${x.status === "sent" ? "Sent" : "Failed"}</span>`;
    });
    const ok = d.filter((x) => x.status === "sent").length;
    setState(`${ok} of ${d.length} emails sent.${ok < d.length ? " Hover a Failed badge to see why." : ""}`, ok < d.length ? "warn" : "");
  } catch (e) {
    setState(esc(e.message), "error");
    idx.forEach((i) => ($("st" + i).innerHTML = badge(true)));
  }
  updateCount();
}

// Subject never stays empty
const fixSubject = () => { if (!$("subject").value.trim()) $("subject").value = DEFAULT_SUBJECT; };
fixSubject();
$("subject").addEventListener("blur", fixSubject);

// Quick city buttons
document.querySelectorAll(".quick button").forEach((b) => (b.onclick = () => ($("location").value = b.dataset.city)));

$("searchBtn").onclick = search;
$("location").addEventListener("keydown", (e) => e.key === "Enter" && search());
$("sendBtn").onclick = send;
loadStatus();