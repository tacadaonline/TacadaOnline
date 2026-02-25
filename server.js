require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const jwt = require('jsonwebtoken');

// --- IMPORTAÇÃO PARA O PROXY E API ---
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- CONFIGURAÇÃO DO AGENTE FIXIE ---
const proxyUrl = process.env.FIXIE_URL;

// --- CACHE DO ACCESS TOKEN BSPAY (OAuth2) ---
let bspayAccessToken = null;
let bspayTokenExpira = 0;

async function obterTokenBspay() {
    if (bspayAccessToken && Date.now() < bspayTokenExpira) {
        return bspayAccessToken;
    }

    console.log("🔑 Gerando novo access_token na BSPAY...");

    // Basic Auth com Base64 (conforme documentação BSPAY)
    const clientId = process.env.BSPAY_CLIENT_ID;
    const clientSecret = process.env.BSPAY_CLIENT_SECRET;
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    console.log("🔑 CLIENT_ID existe?", !!clientId);
    console.log("🔑 CLIENT_SECRET existe?", !!clientSecret);

    const response = await axios.post('https://api.bspay.co/v2/oauth/token', 
        'grant_type=client_credentials',
        {
            httpsAgent: agent,
            proxy: false,
            headers: { 
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            timeout: 10000
        }
    );

    bspayAccessToken = response.data.access_token;
    bspayTokenExpira = Date.now() + ((response.data.expires_in - 300) * 1000);

    console.log("✅ Access token BSPAY obtido com sucesso!");
    return bspayAccessToken;
}
// Agente configurado com timeout para evitar o erro 'undefined'
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl, { keepAlive: true, timeout: 10000 }) : null;

if (proxyUrl) {
    console.log("✅ Proxy FIXIE configurado no servidor.");
} else {
    console.error("❌ AVISO: FIXIE_URL não encontrada nas variáveis de ambiente.");
}

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD_FIXA = process.env.ADMIN_PASS;
if (!ADMIN_PASSWORD_FIXA) {
    console.error("❌ ERRO CRÍTICO: ADMIN_PASS não configurada nas variáveis de ambiente.");
    process.exit(1);
}
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
const apostaLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const premioLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const pixLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// --- SANITIZAR ---
function sanitizar(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- MIDDLEWARE: AUTENTICAR JWT ---
function autenticar(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Token não fornecido' });
    try {
        req.usuario = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(403).json({ success: false, message: 'Token inválido' });
    }
}

// --- ROTA: GERAR PIX (BSPAY COM PROXY) ---
app.post("/api/gerar-pix", pixLimiter, autenticar, async (req, res) => {
    const { valor, cpf, email } = req.body;
    const username = req.usuario.username;

    try {
        const accessToken = await obterTokenBspay();
        const payload = {
            amount: parseFloat(valor),
            external_id: crypto.randomBytes(12).toString('hex'),
            payerQuestion: "Deposito no Jogo",
            payer: {
                name: username,
                document: cpf || "00000000000",
                email: email || `${username}@email.com`
            },
            postbackUrl: `https://${req.get('host')}/api/callback-pix`
        };

        // --- CHAMADA COM URL COMPLETA E HEADERS ---
        const response = await axios.post('https://api.bspay.co/v2/pix/qrcode', payload, {
            httpsAgent: agent,
            proxy: false,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            }
        });

        // Log completo para debug - ver exatamente o que a BSPAY retorna
        console.log("📦 RESPOSTA COMPLETA DA BSPAY:", JSON.stringify(response.data, null, 2));

        const dados = response.data;

        // Mapeamento inteligente - tenta vários nomes de campos possíveis
        const qrcode = dados.qrcode || dados.qr_code || dados.qrCode || dados.qr_code_base64 || dados.qrcode_url || dados.image || dados.qr_code_url || null;
        const pixCopiaECola = dados.pix_copy_paste || dados.pixCopiaECola || dados.pix_code || dados.emv || dados.brcode || dados.payload || dados.copy_paste || dados.qrcode_text || null;

        console.log("🔍 QR Code encontrado?", !!qrcode, "->", typeof qrcode === 'string' ? qrcode.substring(0, 50) + "..." : qrcode);
        console.log("🔍 Pix Copia e Cola encontrado?", !!pixCopiaECola, "->", typeof pixCopiaECola === 'string' ? pixCopiaECola.substring(0, 50) + "..." : pixCopiaECola);

        res.json({ 
            success: true, 
            qrcode: qrcode, 
            pix_copy_paste: pixCopiaECola 
        });

    } catch (error) {
        console.error("❌ ERRO NA API BSPAY:", error.message);
        if (error.response) {
            console.log("Status do Erro:", error.response.status);
            console.log("Detalhes:", JSON.stringify(error.response.data));
        }
        if (error.response?.status === 401) {
            bspayAccessToken = null;
            bspayTokenExpira = 0;
        }
        res.status(500).json({ success: false, message: "Erro ao gerar PIX. Verifique os logs." });
    }
});

// --- RESTANTE DAS ROTAS (REGISTER, LOGIN, APOSTA, ADMIN...) ---

app.post("/api/callback-pix", (req, res) => {
    console.log("📩 Callback PIX recebido:", req.body);
    res.json({ received: true });
});

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
        const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        return res.json({ success: true, username: user.username, saldo: user.saldo, token });
    }
    res.status(400).json({ success: false });
});

app.post("/api/aposta", apostaLimiter, autenticar, async (req, res) => {
    const { valor } = req.body;
    const username = req.usuario.username;
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

app.get("/api/saldo", autenticar, async (req, res) => {
    const user = await User.findOne({ username: req.usuario.username });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, saldo: user.saldo });
});

app.post("/api/solicitar-saque", autenticar, async (req, res) => {
    const { valor, pix } = req.body;
    const username = req.usuario.username;
    const user = await User.findOne({ username: username.trim().toLowerCase() });
    if (!user || user.saldo < valor) return res.status(400).json({ success: false });
    await User.findOneAndUpdate({ username: user.username }, { $inc: { saldo: -valor } });
    await new Saque({ username: user.username, valor, chavePix: pix }).save();
    res.json({ success: true });
});

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
