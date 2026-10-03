require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const {
  GOOGLE_KEY, HUNTER_KEY, GMAIL_USER, GMAIL_PASS,
  SENDER_NAME = "", SENDER_ADDRESS = "", TEST_EMAIL = "",
  LOGIN_USER = "", LOGIN_PASS = "",
} = process.env;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

// ---------- Login helpers ----------
const sign = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("hex");
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function getSession(req) {
  const m = /(?:^|;\s*)session=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const [user, exp, sig] = decodeURIComponent(m[1]).split("|");
  if (!user || !exp || !sig) return null;
  if (!safeEq(sig, sign(user + "|" + exp)) || Date.now() > Number(exp)) return null;
  return user;
}

app.post("/api/login", (req, res) => {
  if (!LOGIN_USER || !LOGIN_PASS)
    return res.status(500).json({ error: "Add LOGIN_USER and LOGIN_PASS in the .env file and restart the server." });
  const { username = "", password = "" } = req.body;
  if (!safeEq(username, LOGIN_USER) || !safeEq(password, LOGIN_PASS))
    return res.status(401).json({ error: "Wrong username or password." });
  const exp = Date.now() + 8 * 3600 * 1000;
  const val = encodeURIComponent(`${username}|${exp}|${sign(username + "|" + exp)}`);
  res.setHeader("Set-Cookie", `session=${val}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
  res.json({ ok: true });
});

app.post("/api/logout", (_q, res) => {
  res.setHeader("Set-Cookie", "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// Every other API needs a login
app.use("/api", (req, res, next) => {
  if (req.path === "/login" || req.path === "/logout") return next();
  if (!getSession(req)) return res.status(401).json({ error: "Please log in." });
  next();
});

// Pages: dashboard only after login
app.get(["/", "/index.html"], (req, res) =>
  getSession(req) ? res.sendFile(path.join(__dirname, "public", "index.html")) : res.redirect("/login.html")
);
app.get("/login.html", (req, res, next) => (getSession(req) ? res.redirect("/") : next()));
app.use(express.static(path.join(__dirname, "public"), { index: false }));

// ---------- API status ----------
app.get("/api/status", (_q, r) =>
  r.json({ google: !!GOOGLE_KEY, hunter: !!HUNTER_KEY, mail: !!(GMAIL_USER && GMAIL_PASS) })
);

// Step 1: Google Places finds businesses. Step 2: Hunter finds an email for each website.
app.post("/api/search", async (req, res) => {
  try {
    const { keyword = "home decor store", location = "", limit = 10 } = req.body;
    if (!GOOGLE_KEY || !HUNTER_KEY)
      return res.status(400).json({ error: "API keys missing. Add GOOGLE_KEY and HUNTER_KEY in the .env file and restart the server." });
    if (!location.trim()) return res.status(400).json({ error: "Enter a US city or state." });

    const g = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.rating",
      },
      body: JSON.stringify({
        textQuery: `${keyword} in ${location}, USA`,
        regionCode: "US",
        maxResultCount: Math.min(Number(limit) || 10, 20),
      }),
    });
    const gd = await g.json();
    if (gd.error) return res.status(400).json({ error: "Google Places: " + gd.error.message });

    let hunterError = null;
    const results = await Promise.all(
      (gd.places || []).map(async (p) => {
        const row = {
          name: p.displayName?.text || "Unknown",
          address: p.formattedAddress || "",
          phone: p.nationalPhoneNumber || "",
          website: p.websiteUri || "",
          rating: p.rating || null,
          email: null,
          contact: "",
        };
        if (!p.websiteUri) return row;
        try {
          const domain = new URL(p.websiteUri).hostname.replace(/^www\./, "");
          const h = await fetch(`https://api.hunter.io/v2/domain-search?domain=${domain}&limit=3&api_key=${HUNTER_KEY}`);
          const hd = await h.json();
          if (hd.errors) hunterError = hunterError || hd.errors[0].details;
          const e = hd?.data?.emails || [];
          const best = e.find((x) => x.type === "personal") || e[0];
          if (best) {
            row.email = best.value;
            row.contact = [best.first_name, best.last_name].filter(Boolean).join(" ") + (best.position ? ` (${best.position})` : "");
          }
        } catch (_) {}
        return row;
      })
    );
    res.json({ results, hunterError, total: results.length, withEmail: results.filter((r) => r.email).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Step 3: send mail with Gmail SMTP (TEST_EMAIL set => every mail goes to your own inbox)
app.post("/api/send", async (req, res) => {
  if (!GMAIL_USER || !GMAIL_PASS) return res.status(400).json({ error: "Add GMAIL_USER and GMAIL_PASS in the .env file." });
  const { buyers = [], subject = "", body = "" } = req.body;
  const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
  const footer = `\n\n--\n${SENDER_NAME}\n${SENDER_ADDRESS}\nNot interested? Reply with "unsubscribe" and we will not contact you again.`;
  const out = [];
  for (const b of buyers) {
    try {
      // {{contact}} becomes only the first name, e.g. "Kacee" (or "there" if no name)
      const first = (b.contact || "").replace(/\s*\(.*\)\s*$/, "").trim().split(" ")[0] || "there";
      const fill = (t) => t.replace(/{{\s*name\s*}}/gi, b.name).replace(/{{\s*contact\s*}}/gi, first);
      await transporter.sendMail({
        from: `"${SENDER_NAME || GMAIL_USER}" <${GMAIL_USER}>`,
        to: TEST_EMAIL || b.email,
        subject: (TEST_EMAIL ? `[TEST for ${b.email}] ` : "") + fill(subject),
        text: fill(body) + footer,
      });
      out.push({ email: b.email, status: "sent" });
    } catch (e) {
      out.push({ email: b.email, status: "failed", error: e.message });
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  res.json(out);
});

app.listen(5000, () => {
  console.log("Buyer Finder running: http://localhost:5000" + (TEST_EMAIL ? " (TEST MODE: mails go to " + TEST_EMAIL + ")" : ""));
  require("child_process").exec("start http://localhost:5000"); // opens the browser on Windows
});