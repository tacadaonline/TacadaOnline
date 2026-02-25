require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

// --- MODIFICAÇÃO: IMPORTAÇÃO PARA O PROXY E API ---
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, ".")));

// --- MODIFICAÇÃO: CONFIGURAÇÃO DO AGENTE FIXIE ---
// Certifique-se de adicionar FIXIE_URL no painel do Render
const proxyUrl = process.env.FIXIE_URL;
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_PASSWORD_FIXA = process.env.ADMIN_PASS || "mude-isso-no-env"; 
let globalRTP = 0.30; 

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ BANCO CONECTADO"))
    .catch(err => console.error("❌ ERRO BANCO:", err));

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

// --- LIMITADORES ---
const apostaLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const premioLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// --- ROTA: GERAR PIX (BSPAY COM PROXY) ---
app.post("/api/gerar-pix", async (req, res) => {
    const { username, valor, cpf, email } = req.body;

    if (!username || !valor || valor < 1) {
        return res.status(400).json({ success: false, message: "Dados inválidos" });
    }

    try {
        // --- COLE O TESTE AQUI (DENTRO DO TRY) ---
        const testeIp = await axios.get('https://api.ipify.org', { 
            httpsAgent: agent, 
            proxy: false 
        });
        console.log("CONFIRMAÇÃO: Saindo pelo IP:", testeIp.data.ip);
        
        // Payload baseado no seu exemplo PHP
        const payload = {
            amount: valor,
            external_id: crypto.randomBytes(12).toString('hex'),
            payerQuestion: "Deposito no Jogo",
            payer: {
                name: username,
                document: cpf || "00000000000", // BSPAY exige CPF válido (11 dígitos)
                email: email || `${username}@email.com`
            },
            postbackUrl: `https://${req.get('host')}/api/callback-pix`
        };

       // Chamada via Axios usando o Túnel do Fixie (CORRIGIDO)
const response = await axios.post('https://api.bspay.co', payload, {
    httpsAgent: agent,
    proxy: false,
    headers: {
        'Authorization': `Bearer ${process.env.BSPAY_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
    }
});

        res.json({ 
            success: true, 
            qrcode: response.data.qrcode, 
            pix_copy_paste: response.data.pix_copy_paste 
        });

    } catch (error) {
        console.error("[BSPAY ERROR] Status:", error.response?.status);
        console.log("Detalhes do Erro:", error.response?.data);

        if (error.response?.status === 403) {
            return res.status(403).json({ 
                success: false, 
                message: "Acesso Negado (403). Libere os IPs do Fixie no painel da BSPAY." 
            });
        }
        res.status(500).json({ success: false, message: "Erro ao processar pagamento" });
    }
});

// --- ROTAS DE USUÁRIO ---
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

app.post("/api/aposta", apostaLimiter, async (req, res) => {
    const { username, valor } = req.body;
    if (!username || typeof valor !== 'number' || isNaN(valor) || valor <= 0) {
        return res.status(400).json({ success: false, message: "Dados inválidos" });
    }
    const ganhou = Math.random() < globalRTP;
    const atualizado = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase(), saldo: { $gte: valor } },
        { $inc: { saldo: -valor } },
        { new: true }
    );
    if (!atualizado) return res.status(400).json({ success: false, message: "Saldo insuficiente" });
    if (!ganhou && atualizado.indicadoPor) {
        await User.findOneAndUpdate({ username: atualizado.indicadoPor }, { $inc: { comissao: valor * 0.10 } });
    }
    let premioToken = null;
    if (ganhou) {
        premioToken = crypto.randomBytes(32).toString('hex');
        await User.findOneAndUpdate({ username: username.trim().toLowerCase() }, { $set: { premioToken: premioToken, premioValor: valor } });
    }
    res.json({ success: true, saldo: atualizado.saldo, ganhou, premioToken });
});

app.post("/api/premio", premioLimiter, async (req, res) => {
    const { username, premioToken } = req.body;
    const user = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase(), premioToken: premioToken, premioValor: { $ne: null } },
        { $set: { premioToken: null } },
        { new: false }
    );
    if (!user || !user.premioValor) return res.status(400).json({ success: false, message: "Token inválido" });
    const premio = user.premioValor * 3;
    const atualizado = await User.findOneAndUpdate({ username: username.trim().toLowerCase() }, { $inc: { saldo: premio }, $set: { premioValor: null } }, { new: true });
    res.json({ success: true, saldo: atualizado.saldo });
});

app.get("/api/saldo", async (req, res) => {
    const user = await User.findOne({ username: req.query.user?.trim().toLowerCase() });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, saldo: user.saldo });
});

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

app.listen(process.env.PORT || 10000, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${process.env.PORT || 10000}`);
});
