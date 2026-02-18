const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const axios = require("axios");

const app = express();

// --- CONFIGURAÇÕES ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, ".")));

// --- CREDENCIAIS ---
const SUITPAY_ID = process.env.SUITPAY_ID || "COLE_SEU_CI_AQUI";
const SUITPAY_SECRET = process.env.SUITPAY_SECRET || "COLE_SEU_CS_AQUI";
const SUITPAY_URL = "https://api.suitpay.app";

const ADMIN_PASSWORD_FIXA = "admin123"; 
let globalRTP = 0.95; 

// --- CONEXÃO COM O MONGODB ---
const MONGO_URI = "mongodb+srv://joaoprofvitor:qFmbWQW1ckquJ5Ql@cluster0.mavkxio.mongodb.net/tacada?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ BANCO DE DADOS CONECTADO!"))
    .catch(err => console.error("❌ ERRO NO BANCO:", err));

// --- MODELO DE USUÁRIO ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    depositoInicial: { type: Number, default: 0 } 
});
const User = mongoose.model("User", UserSchema);

// --- ROTAS ADMIN (PAINEL) ---

app.post("/admin/usuarios", async (req, res) => {
    const { senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    try {
        const usuarios = await User.find({}, { password: 0 });
        res.json({ success: true, usuarios });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/admin/set-rtp", (req, res) => {
    const { rtp, senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    globalRTP = parseFloat(rtp);
    res.json({ success: true });
});

// ADICIONAR SALDO (CORRIGIDO)
app.post("/admin/add-saldo", async (req, res) => {
    const { username, valor, senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    
    try {
        const userBusca = username.trim().toLowerCase();
        const valorNum = parseFloat(valor);
        const usuario = await User.findOneAndUpdate(
            { username: userBusca }, 
            { $inc: { saldo: valorNum } }, 
            { new: true }
        );
        if(!usuario) return res.status(404).json({ success: false, msg: "Usuário não existe" });
        res.json({ success: true, novoSaldo: usuario.saldo });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post("/admin/pagar-saque", async (req, res) => {
    const { username, senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    try {
        await User.findOneAndUpdate({ username: username.trim().toLowerCase() }, { $set: { saldo: 0 } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get("/admin/get-rtp", (req, res) => res.json({ rtp: globalRTP }));

// --- ROTAS DE LOGIN / JOGO ---

app.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const novoUsuario = new User({ 
            username: username.trim().toLowerCase(), 
            password: hashedPassword 
        });
        await novoUsuario.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const usuario = await User.findOne({ username: username.trim().toLowerCase() });
        if (!usuario) return res.status(401).json({ success: false });
        const senhaValida = await bcrypt.compare(password, usuario.password);
        if (!senhaValida) return res.status(401).json({ success: false });
        res.json({ success: true, username: usuario.username, saldo: usuario.saldo });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/update-saldo", async (req, res) => {
    try {
        const { username, valor } = req.body;
        const valorNum = parseFloat(valor);
        const usuario = await User.findOneAndUpdate(
            { username: username.trim().toLowerCase() }, 
            { $inc: { saldo: valorNum } }, 
            { new: true }
        );
        res.json({ success: true, novoSaldo: usuario.saldo });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- SUITPAY WEBHOOK ---

app.post("/api/webhook-suitpay", async (req, res) => {
    const { status, requestNumber, amount } = req.body;
    if (status === "PAID") {
        const parts = requestNumber.split('_');
        const username = parts[2]; // Pega o nome correto enviado no requestNumber
        await User.findOneAndUpdate(
            { username: username.trim().toLowerCase() }, 
            { $inc: { saldo: parseFloat(amount) } }
        );
    }
    res.sendStatus(200);
});

// --- START ---
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVIDOR ON NA PORTA ${PORT}`));
