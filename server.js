require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, ".")));

const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_PASSWORD_FIXA = process.env.ADMIN_PASS || "mude-isso-no-env"; 
let globalRTP = 0.30; 

mongoose.connect(MONGO_URI).then(() => console.log("✅ BANCO CONECTADO")).catch(err => console.error("❌ ERRO BANCO:", err));

// --- SCHEMAS ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    indicadoPor: { type: String, default: null },
    comissao: { type: Number, default: 0 }
});
const User = mongoose.model("User", UserSchema);

const SaqueSchema = new mongoose.Schema({
    username: String,
    valor: Number,
    chavePix: String,
    status: { type: String, default: "pendente" },
    data: { type: Date, default: Date.now }
});
const Saque = mongoose.model("Saque", SaqueSchema);

// --- ROTAS DE JOGO E USUÁRIO ---
app.post("/api/register", async (req, res) => {
    try {
        const { username, password, ref } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const novo = new User({ username: username.trim().toLowerCase(), password: hashedPassword, indicadoPor: ref || null });
        await novo.save();
        res.json({ success: true });
    } catch (err) { res.status(400).json({ success: false }); }
});

app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username.trim().toLowerCase() });
    if (user && await bcrypt.compare(password, user.password)) {
        return res.json({ success: true, username: user.username, saldo: user.saldo });
    }
    res.status(400).json({ success: false });
});

app.post("/api/aposta", async (req, res) => {
    const { username, valor } = req.body;

    if (!username || typeof valor !== 'number' || isNaN(valor) || valor <= 0) {
        return res.status(400).json({ success: false, message: "Dados inválidos" });
    }

    const ganhou = Math.random() < globalRTP;
    const mudanca = ganhou ? (valor * 2) : -valor;

    // Operação ATÔMICA: só atualiza se saldo >= valor
    const atualizado = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase(), saldo: { $gte: valor } },
        { $inc: { saldo: mudanca } },
        { new: true }
    );

    if (!atualizado) {
        return res.status(400).json({ success: false, message: "Saldo insuficiente" });
    }

    // Comissão de indicação (se perdeu)
    if (!ganhou && atualizado.indicadoPor) {
        await User.findOneAndUpdate(
            { username: atualizado.indicadoPor },
            { $inc: { comissao: valor * 0.10 } }
        );
    }

    res.json({ success: true, saldo: atualizado.saldo, ganhou });
});

app.get("/api/saldo", async (req, res) => {
    const user = await User.findOne({ username: req.query.user?.trim().toLowerCase() });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, saldo: user.saldo });
});

// NOVO: ROTA PARA JOGADOR SOLICITAR SAQUE
app.post("/api/solicitar-saque", async (req, res) => {
    const { username, valor, pix } = req.body;
    const user = await User.findOne({ username: username.trim().toLowerCase() });
    if (!user || user.saldo < valor) return res.status(400).json({ success: false });

    await User.findOneAndUpdate({ username: user.username }, { $inc: { saldo: -valor } });
    await new Saque({ username: user.username, valor, chavePix: pix }).save();
    res.json({ success: true });
});

// --- ROTAS ADMIN ---
app.post("/admin/usuarios", async (req, res) => {
    if (req.body.senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    const users = await User.find({}, 'username saldo indicadoPor comissao').sort({ saldo: -1 });
    res.json({ success: true, usuarios: users });
});

app.post("/admin/saques-pendentes", async (req, res) => {
    if (req.body.senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    const saques = await Saque.find({ status: "pendente" });
    res.json({ success: true, saques });
});

app.post("/admin/set-rtp", (req, res) => {
    if (req.body.senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    globalRTP = parseFloat(req.body.rtp);
    res.json({ success: true });
});

app.get("/admin/get-rtp", (req, res) => res.json({ rtp: globalRTP }));

app.post("/admin/add-saldo", async (req, res) => {
    if (req.body.senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    await User.findOneAndUpdate({ username: req.body.username }, { $inc: { saldo: parseFloat(req.body.valor) } });
    res.json({ success: true });
});

app.listen(process.env.PORT || 10000, '0.0.0.0');
