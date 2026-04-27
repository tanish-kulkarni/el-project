const express = require("express");
const multer = require("multer");
const fs = require("fs");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer"); // ✅ ADDED

const app = express();

const SECRET = "supersecretkey";

// ✅ ADDED: Gmail SMTP transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "venatrix.otp@gmail.com",
    pass: "ezwcnagzuqyjdbby"
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

console.log("🔥 SERVER FILE LOADED");

// ✅ ADDED: In-memory OTP store { "signup:email": { otp, expiresAt, pendingUser } }
const otpStore = {};

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(toEmail, otp) {
  await transporter.sendMail({
    from: '"Venatrix OTP" <venatrix.otp@gmail.com>',
    to: toEmail,
    subject: "Your Signup OTP",
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:8px;">
        <h2 style="color:#1e293b;">Verify your email</h2>
        <p style="color:#475569;">Use the OTP below to complete your signup. It expires in <strong>5 minutes</strong>.</p>
        <div style="font-size:2rem;font-weight:bold;letter-spacing:0.3rem;color:#6366f1;padding:16px 0;">${otp}</div>
        <p style="color:#94a3b8;font-size:0.85rem;">If you didn't request this, please ignore this email.</p>
      </div>
    `
  });
}


// =========================
// 🔐 AUTH MIDDLEWARE
// =========================
function auth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).send("No token");
  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).send("Invalid token");
  }
}


// =========================
// 📦 LOAD DATA
// =========================
function getInstitutes() {
  return JSON.parse(fs.readFileSync("institutes.json"));
}

function saveInstitutes(data) {
  fs.writeFileSync("institutes.json", JSON.stringify(data, null, 2));
}

let documents = fs.existsSync("data.json")
  ? JSON.parse(fs.readFileSync("data.json"))
  : [];

let workflows = JSON.parse(fs.readFileSync("workflows.json"));


// =========================
// 🔐 LOGIN — unchanged, works for all users with or without email
// =========================
app.post("/login", async (req, res) => {
  const { username, password, institute } = req.body;

  const institutes = getInstitutes();
  const inst = institutes.find(i => i.name === institute);

  if (!inst) return res.status(400).send("Invalid institute");

  const user = inst.users.find(u => u.username === username);
  if (!user) return res.status(401).send("User not found");

  if (user.role === "PENDING") {
    return res.status(403).send("Awaiting admin approval");
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).send("Wrong password");

  const token = jwt.sign(
    { username: user.username, role: user.role, institute: inst.name },
    SECRET,
    { expiresIn: "2h" }
  );

  res.json({ token });
});


// =========================
// 🆕 SIGNUP — STEP 1: Validate, send OTP
// POST /signup-request → { username, password, email, institute }
// =========================
app.post("/signup-request", async (req, res) => {
  console.log("🔥 SIGNUP REQUEST HIT");

  const { username, password, email, institute } = req.body;

  if (!username || !password || !email || !institute) {
    return res.status(400).send("All fields required");
  }

  if (!email.endsWith("@rvce.edu.in")) {
    return res.status(400).send("Use institute email only");
  }

  const institutes = getInstitutes();
  const inst = institutes.find(i => i.name === institute);

  if (!inst) return res.status(400).send("Invalid institute");

  if (inst.users.find(u => u.username === username)) {
    return res.status(400).send("Username already exists");
  }

  if (inst.users.find(u => u.email === email)) {
    return res.status(400).send("Email already registered");
  }

  // ✅ Generate OTP and hold the signup data until verified
  const otp = generateOTP();
  const key = `signup:${email}`;
  otpStore[key] = {
    otp,
    expiresAt: Date.now() + 5 * 60 * 1000,
    pendingUser: { username, password, email, institute }
  };

  try {
    await sendOTPEmail(email, otp);
  } catch (err) {
    console.error("Email error:", err);
    return res.status(500).send("Failed to send OTP email");
  }

  res.json({ message: "OTP sent to your email" });
});


// =========================
// 🆕 SIGNUP — STEP 2: Verify OTP, create account
// POST /verify-otp → { email, otp }
// =========================
app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).send("Missing fields");
  }

  const key = `signup:${email}`;
  const record = otpStore[key];

  if (!record) {
    return res.status(400).send("No OTP requested. Please sign up first.");
  }

  if (Date.now() > record.expiresAt) {
    delete otpStore[key];
    return res.status(400).send("OTP expired. Please sign up again.");
  }

  if (record.otp !== otp) {
    return res.status(401).send("Invalid OTP");
  }

  // ✅ OTP valid — create the account
  delete otpStore[key];

  const { username, password, institute } = record.pendingUser;
  const institutes = getInstitutes();
  const inst = institutes.find(i => i.name === institute);

  const hashed = await bcrypt.hash(password, 10);

  inst.users.push({
    username,
    password: hashed,
    role: "PENDING",
    email
  });

  saveInstitutes(institutes);

  res.send("Signup submitted. Await admin approval.");
});


// =========================
// 🟢 APPROVE USER (PROTECTED)
// =========================
app.post("/approve-user", auth, (req, res) => {
  if (req.user.role !== "ADMIN") return res.status(403).send("Not allowed");

  const { username, institute, role } = req.body;
  const institutes = getInstitutes();
  const inst = institutes.find(i => i.name === institute);

  if (!inst) return res.status(400).send("Institute not found");

  const user = inst.users.find(u => u.username === username);
  if (!user) return res.status(400).send("User not found");
  if (user.role !== "PENDING") return res.status(400).send("User already approved");
  if (role === "ADMIN") return res.status(400).send("Cannot assign ADMIN");

  user.role = role;
  saveInstitutes(institutes);
  res.send("User approved");
});


// =========================
// 🏗️ CREATE ROLE (PROTECTED)
// =========================
app.post("/create-role", auth, (req, res) => {
  if (req.user.role !== "ADMIN") return res.status(403).send("Not allowed");

  const { role, institute } = req.body;
  if (!role) return res.status(400).send("Role required");
  if (role === "ADMIN") return res.status(400).send("ADMIN role is reserved");

  const institutes = getInstitutes();
  const inst = institutes.find(i => i.name === institute);
  if (!inst) return res.status(400).send("Institute not found");

  if (!inst.roles.includes(role)) inst.roles.push(role);

  saveInstitutes(institutes);
  res.send("Role created");
});


// =========================
// 📤 GET ROLES (PROTECTED)
// =========================
app.get("/roles/:institute", auth, (req, res) => {
  const institutes = getInstitutes();
  const inst = institutes.find(i => i.name === req.params.institute);
  if (!inst) return res.status(400).send("Institute not found");
  res.json(inst.roles);
});


// =========================
// 👤 CREATE USER (PROTECTED)
// =========================
app.post("/create-user", auth, async (req, res) => {
  if (req.user.role !== "ADMIN") return res.status(403).send("Not allowed");

  const { username, password, role, institute } = req.body;
  if (!username || !password || !role) return res.status(400).send("All fields required");
  if (role === "ADMIN") return res.status(400).send("Cannot create ADMIN user");

  const institutes = getInstitutes();
  const inst = institutes.find(i => i.name === institute);
  if (!inst) return res.status(400).send("Invalid institute");
  if (inst.users.find(u => u.username === username)) return res.status(400).send("User already exists");
  if (!inst.roles.includes(role)) return res.status(400).send("Role does not exist");

  const hashed = await bcrypt.hash(password, 10);
  inst.users.push({ username, password: hashed, role });
  saveInstitutes(institutes);
  res.send("User created");
});


// =========================
// 📤 GET USERS (PROTECTED)
// =========================
app.get("/users/:institute", auth, (req, res) => {
  const institutes = getInstitutes();
  const inst = institutes.find(i => i.name === req.params.institute);
  if (!inst) return res.status(400).send("Institute not found");
  res.json(inst.users.map(u => ({ username: u.username, role: u.role, email: u.email || "-" })));
});


// =========================
// 📥 UPLOAD (PROTECTED)
// =========================
app.post("/upload", auth, upload.single("file"), (req, res) => {
  const name = req.file.originalname.toLowerCase();
  let type = "leave";

  workflows.forEach(w => {
    if (name.includes(w.type)) type = w.type;
  });

  const wf = workflows.find(w => w.type === type);
  const doc = {
    id: Date.now(),
    name: req.file.originalname,
    type,
    flow: wf ? wf.flow : ["ADMIN"],
    currentStep: 0,
    status: "Pending"
  };

  documents.push(doc);
  fs.writeFileSync("data.json", JSON.stringify(documents, null, 2));
  res.json(doc);
});


// =========================
// 📤 GET DOCS (PROTECTED)
// =========================
app.get("/documents", auth, (req, res) => {
  res.json(documents);
});


// =========================
// 🔄 APPROVE DOC (PROTECTED)
// =========================
app.post("/approve", auth, (req, res) => {
  const { id, role } = req.body;

  documents = documents.map(doc => {
    if (doc.id === id && doc.flow[doc.currentStep] === role) {
      doc.currentStep++;
      if (doc.currentStep >= doc.flow.length) doc.status = "Fully Approved";
    }
    return doc;
  });

  fs.writeFileSync("data.json", JSON.stringify(documents, null, 2));
  res.send("Approved");
});


// =========================
// 🏗️ WORKFLOW (PROTECTED)
// =========================
app.post("/create-workflow", auth, (req, res) => {
  const { type, flow } = req.body;
  workflows.push({ type, flow });
  fs.writeFileSync("workflows.json", JSON.stringify(workflows, null, 2));
  res.send("Workflow created");
});

app.get("/workflows", auth, (req, res) => {
  res.json(workflows);
});


// =========================
// 🚀 START
// =========================
app.listen(3000, () => {
  console.log("🚀 Running on http://localhost:3000");
});