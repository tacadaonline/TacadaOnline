require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const bspayService = require('./services/bspay.service');

const app = express();
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-mude-em-producao";

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
    comissao: { type: Number, default: 0 },
    premioToken: { type: String, default: null },
    premioValor: { type: Number, default: null }
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
const apostaLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const premioLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const saqueLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const saldoLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const adminLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

function autenticar(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: "Não autenticado" });
    }
    const token = authHeader.slice(7);
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (!payload.username || typeof payload.username !== 'string') {
            return res.status(401).json({ success: false, message: "Token inválido" });
        }
        req.usuario = payload.username.trim().toLowerCase();
        next();
    } catch (e) {
        return res.status(401).json({ success: false, message: "Token inválido" });
    }
}

app.post("/api/register", registerLimiter, async (req, res) => {
    try {
        const { username, password, ref } = req.body;
        if (!username || typeof username !== 'string') {
            return res.status(400).json({ success: false, message: "Username inválido" });
        }
        const cleanUsername = username.trim().toLowerCase();
        if (cleanUsername.length < 3 || cleanUsername.length > 30 || !/^[a-z0-9_]+$/.test(cleanUsername)) {
            return res.status(400).json({ success: false, message: "Username inválido (3-30 chars, letras/números/underscore)" });
        }
        if (!password || password.length < 4) {
            return res.status(400).json({ success: false, message: "Senha deve ter pelo menos 4 caracteres" });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const novo = new User({ username: cleanUsername, password: hashedPassword, indicadoPor: ref || null });
        await novo.save();
        res.json({ success: true });
    } catch (err) { res.status(400).json({ success: false }); }
});

app.post("/api/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || typeof username !== 'string' || !password) {
        return res.status(400).json({ success: false });
    }
    const user = await User.findOne({ username: username.trim().toLowerCase() });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ success: true, username: user.username, saldo: user.saldo, token });
    }
    res.status(400).json({ success: false });
});

app.post("/api/aposta", apostaLimiter, autenticar, async (req, res) => {
    const username = req.usuario;
    const { valor } = req.body;

    if (typeof valor !== 'number' || isNaN(valor) || valor <= 0 || valor > 10000) {
        return res.status(400).json({ success: false, message: "Dados inválidos" });
    }

    const valorArredondado = Math.round(valor * 100) / 100;

    const ganhou = Math.random() < globalRTP;

    // SEMPRE subtrai o valor da aposta (independente de ganhar ou perder)
    const atualizado = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase(), saldo: { $gte: valorArredondado } },
        { $inc: { saldo: -valorArredondado } },
        { new: true }
    );

    if (!atualizado) {
        return res.status(400).json({ success: false, message: "Saldo insuficiente" });
    }

    // Comissão de indicação (jogador apostou, casa fica com o valor se perder)
    if (!ganhou && atualizado.indicadoPor) {
        await User.findOneAndUpdate(
            { username: atualizado.indicadoPor },
            { $inc: { comissao: valorArredondado * 0.10 } }
        );
    }

    // Se ganhou, gerar token de prêmio (uso único)
    let premioToken = null;
    if (ganhou) {
        premioToken = crypto.randomBytes(32).toString('hex');
        await User.findOneAndUpdate(
            { username: username.trim().toLowerCase() },
            { $set: { premioToken: premioToken, premioValor: valorArredondado } }
        );
    }

    res.json({ success: true, saldo: atualizado.saldo, premioToken });
});

app.post("/api/premio", premioLimiter, autenticar, async (req, res) => {
    const username = req.usuario;
    const { premioToken } = req.body;

    if (!premioToken || typeof premioToken !== 'string') {
        return res.status(400).json({ success: false, message: "Dados inválidos" });
    }

    // Buscar e INVALIDAR o token atomicamente (só pode usar uma vez)
    const user = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase(), premioToken: premioToken, premioValor: { $ne: null } },
        { $set: { premioToken: null } },
        { new: false }
    );

    if (!user || !user.premioValor) {
        return res.status(400).json({ success: false, message: "Token inválido ou já utilizado" });
    }

    const premio = user.premioValor * 3;

    const atualizado = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase() },
        { $inc: { saldo: premio }, $set: { premioValor: null } },
        { new: true }
    );

    res.json({ success: true, saldo: atualizado.saldo });
});

app.get("/api/saldo", saldoLimiter, autenticar, async (req, res) => {
    const user = await User.findOne({ username: req.usuario });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, saldo: user.saldo });
});

// ROTA PARA JOGADOR SOLICITAR SAQUE
app.post("/api/solicitar-saque", saqueLimiter, autenticar, async (req, res) => {
    const username = req.usuario;
    const { valor, pix } = req.body;

    // Validações rigorosas
    if (!pix || typeof pix !== 'string' || pix.trim().length < 5) {
        return res.status(400).json({ success: false, message: "Chave PIX inválida" });
    }
    if (typeof valor !== 'number' || isNaN(valor) || valor < 1 || valor > 10000) {
        return res.status(400).json({ success: false, message: "Valor de saque inválido (mín R$1, máx R$10.000)" });
    }

    // Operação atômica — evita race condition (saque duplo)
    const atualizado = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase(), saldo: { $gte: valor } },
        { $inc: { saldo: -valor } },
        { new: true }
    );

    if (!atualizado) {
        return res.status(400).json({ success: false, message: "Saldo insuficiente" });
    }

    await new Saque({ username: atualizado.username, valor, chavePix: pix.trim() }).save();
    res.json({ success: true, saldo: atualizado.saldo });
});

// --- ROTAS DA BSPAY ---

// 1. Rota para o Jogador pedir o PIX (QR Code)
app.post("/api/pix/gerar", async (req, res) => {
    try {
        // Envia para o service os dados: { nome, cpf, valor }
        const pixData = await bspayService.gerarPix(req.body);
        res.json(pixData);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Webhook: A BSPAY avisa seu servidor que o dinheiro caiu
app.post("/webhook/bspay", async (req, res) => {
    const { status, value, name } = req.body;

    // Se o status for pago (PAID ou COMPLETED)
    if (status === 'PAID' || status === 'COMPLETED') {
        const valorPago = parseFloat(value);
        
        // BUSCA O USUÁRIO PELO NOME (ou outro identificador que você enviar)
        // Dica: No front, envie o nome do usuário no campo 'name' da BSPAY
        const user = await User.findOneAndUpdate(
            { username: name.trim().toLowerCase() }, 
            { $inc: { saldo: valorPago } }
        );

        if (user) {
            console.log(`[BSPAY] Saldo de R$${valorPago} adicionado para: ${name}`);
        }
    }

    // Retorna 200 para a BSPAY não reenviar o aviso
    res.status(200).send("OK");
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
    const rtp = parseFloat(req.body.rtp);
    if (isNaN(rtp) || rtp < 0 || rtp > 1) {
        return res.status(400).json({ success: false, message: "RTP inválido (deve ser entre 0 e 1)" });
    }
    globalRTP = rtp;
    res.json({ success: true });
});

app.post("/admin/get-rtp", (req, res) => {
    if (req.body.senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    res.json({ success: true, rtp: globalRTP });
});

app.post("/admin/add-saldo", adminLimiter, async (req, res) => {
    if (req.body.senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    const { username, valor } = req.body;
    if (!username || typeof username !== 'string') {
        return res.status(400).json({ success: false, message: "Username inválido" });
    }
    const parsedValor = parseFloat(valor);
    if (isNaN(parsedValor)) {
        return res.status(400).json({ success: false, message: "Valor inválido" });
    }
    const user = await User.findOneAndUpdate({ username: username.trim().toLowerCase() }, { $inc: { saldo: parsedValor } });
    if (!user) return res.status(404).json({ success: false, message: "Usuário não encontrado" });
    res.json({ success: true });
});

app.listen(process.env.PORT || 10000, '0.0.0.0');
