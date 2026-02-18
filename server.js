const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, ".")));

const SUITPAY_ID = process.env.SUITPAY_ID || "COLE_SEU_CI_AQUI";
const SUITPAY_SECRET = process.env.SUITPAY_SECRET || "COLE_SEU_CS_AQUI";
const SUITPAY_URL = "https://api.suitpay.app";

const ADMIN_PASSWORD_FIXA = "admin123"; 
let globalRTP = 0.95; 

const MONGO_URI = "mongodb+srv://joaoprofvitor:qFmbWQW1ckquJ5Ql@cluster0.mavkxio.mongodb.net/tacada?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ BANCO CONECTADO!"))
    .catch(err => console.error("❌ ERRO BANCO:", err));

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    saldo: { type: Number, default: 0 }
});
const User = mongoose.model("User", UserSchema);

// --- NOVA ROTA: O JOGO VAI USAR ESSA PARA ATUALIZAR O SALDO NA TELA ---
app.get("/get-saldo/:username", async (req, res) => {
    try {
        const usuario = await User.findOne({ username: req.params.username.trim().toLowerCase() });
        if (usuario) res.json({ success: true, saldo: usuario.saldo });
        else res.status(404).json({ success: false });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- ADMIN ---
app.post("/admin/usuarios", async (req, res) => {
    const { senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    try {
        const usuarios = await User.find({}, { password: 0 });
        res.json({ success: true, usuarios });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/admin/add-saldo", async (req, res) => {
    const { username, valor, senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    try {
        const usuario = await User.findOneAndUpdate(
            { username: username.trim().toLowerCase() }, 
            { $inc: { saldo: parseFloat(valor) } }, 
            { new: true }
        );
        res.json({ success: true, novoSaldo: usuario.saldo });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post("/admin/set-rtp", (req, res) => {
    if (req.body.senha === ADMIN_PASSWORD_FIXA) {
        globalRTP = parseFloat(req.body.rtp);
        res.json({ success: true });
    } else res.status(403).json({ success: false });
});

app.get("/admin/get-rtp", (req, res) => res.json({ rtp: globalRTP }));

// --- LOGIN / JOGO ---
app.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        await new User({ username: username.trim().toLowerCase(), password: hashedPassword }).save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/login", async (req, res) => {
    try {
        const usuario = await User.findOne({ username: req.body.username.trim().toLowerCase() });
        if (usuario && await bcrypt.compare(req.body.password, usuario.password)) {
            res.json({ success: true, username: usuario.username, saldo: usuario.saldo });
        } else res.status(401).json({ success: false });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/update-saldo", async (req, res) => {
    try {
        const usuario = await User.findOneAndUpdate(
            { username: req.body.username.trim().toLowerCase() }, 
            { $inc: { saldo: parseFloat(req.body.valor) } }, 
            { new: true }
        );
        res.json({ success: true, novoSaldo: usuario.saldo });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/api/webhook-suitpay", async (req, res) => {
    if (req.body.status === "PAID") {
        const username = req.body.requestNumber.split('_')[2];
        await User.findOneAndUpdate({ username: username.toLowerCase() }, { $inc: { saldo: parseFloat(req.body.amount) } });
    }
    res.sendStatus(200);
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log("🚀 RODANDO"));
