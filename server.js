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
const QRCode = require('qrcode');

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});
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
    affiliateLink: { type: String, default: null, unique: true, sparse: true },
    indicadoPor: { type: String, default: null },
    comissao: { type: Number, default: 0 },
    comissaoSacada: { type: Number, default: 0 },
    primeiroDepositoPago: { type: Boolean, default: false },
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

const DepositoSchema = new mongoose.Schema({
    external_id: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    valor: { type: Number, required: true },
    status: { type: String, default: "pendente" }, // pendente | pago
    created_at: { type: Date, default: Date.now },
    paid_at: { type: Date, default: null }
});
const Deposito = mongoose.model("Deposito", DepositoSchema);

// --- LIMITADORES ---
const apostaLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const premioLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const pixLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const callbackLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { success: false, message: "Muitas tentativas de cadastro. Aguarde 1 hora." }, standardHeaders: true, legacyHeaders: false });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { success: false, message: "Muitas tentativas. Aguarde 15 minutos." }, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { success: false, message: "Muitas tentativas. Aguarde 15 minutos." }, standardHeaders: true, legacyHeaders: false });
const saqueLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const affiliateLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const affiliateWithdrawLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

// --- SANITIZAR ---
function sanitizar(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- VERIFICAR SENHA ADMIN (timing-safe) ---
function verificarSenhaAdmin(input) {
    if (!input || typeof input !== 'string') return false;
    const a = Buffer.from(input);
    const b = Buffer.from(ADMIN_PASSWORD_FIXA);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
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

    if (typeof valor !== 'number' || isNaN(valor) || !isFinite(valor) || valor < 1 || valor > 50000) {
        return res.status(400).json({ success: false, message: "Valor inválido para depósito" });
    }
    const valorPix = Math.round(valor * 100) / 100;

    try {
        const accessToken = await obterTokenBspay();
        const externalId = crypto.randomBytes(12).toString('hex');
        const payload = {
            amount: valorPix,
            external_id: externalId,
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

        // Salvar depósito pendente para rastrear pelo external_id no callback
        await new Deposito({
            external_id: externalId,
            username: username,
            valor: valorPix,
            status: "pendente"
        }).save();
        console.log(`💾 Depósito pendente salvo: ${externalId} para ${username} R$ ${valorPix.toFixed(2)}`);

        const dados = response.data;

        const textoEMV = dados.qrcode;
        const qrcodeImage = await QRCode.toDataURL(textoEMV, { width: 300, margin: 2 });

        res.json({ 
            success: true, 
            qrcode_image: qrcodeImage,
            pix_copy_paste: textoEMV
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

app.post("/api/callback-pix", callbackLimiter, async (req, res) => {
    console.log("📩 Callback PIX recebido:", JSON.stringify(req.body, null, 2));

    try {
        const rawBody = req.body;
        // BSPAY envia os dados dentro de requestBody — extrair corretamente
        const body = rawBody.requestBody || rawBody;
        const status = (body.status || "").toString().toLowerCase();
        const externalId = body.external_id || body.externalId || body.id || body.transactionId;
        if (!body.external_id && !body.externalId && !body.transactionId && body.id) {
            console.log(`⚠️ Callback usa campo 'id' como fallback para external_id: ${body.id}`);
        }

        if (!["paid", "approved", "confirmed", "completed"].includes(status)) {
            console.log(`⚠️ Status do PIX não é pago: ${body.status}`);
            return res.json({ received: true });
        }

        if (!externalId) {
            console.log("❌ Callback sem external_id:", body);
            return res.status(400).json({ received: true, error: "Sem external_id" });
        }

        // Buscar depósito e marcar como pago atomicamente (evita crédito duplicado)
        // new: false retorna o documento ANTES da atualização; null significa que já foi processado
        const deposito = await Deposito.findOneAndUpdate(
            { external_id: externalId.toString(), status: "pendente" },
            { $set: { status: "pago", paid_at: new Date() } },
            { new: false }
        );

        if (!deposito) {
            console.log(`⚠️ Depósito não encontrado ou já pago: ${externalId}`);
            return res.json({ received: true });
        }

        // Creditar saldo ao usuário correto
        const atualizado = await User.findOneAndUpdate(
            { username: deposito.username },
            { $inc: { saldo: deposito.valor } },
            { new: true }
        );

        if (atualizado) {
            console.log(`✅ Saldo atualizado para ${deposito.username}: +R$ ${deposito.valor.toFixed(2)} (Novo saldo: R$ ${atualizado.saldo.toFixed(2)}) [ext_id: ${externalId}]`);

            // Comissão de afiliado: 10% sobre o primeiro depósito do indicado (operação atômica)
            if (atualizado.indicadoPor) {
                const marcouPrimeiro = await User.findOneAndUpdate(
                    { username: deposito.username, primeiroDepositoPago: false },
                    { $set: { primeiroDepositoPago: true } },
                    { new: false }
                );
                if (marcouPrimeiro) {
                    const comissaoValor = Math.round(deposito.valor * 0.10 * 100) / 100;
                    try {
                        const referrer = await User.findOneAndUpdate(
                            { username: atualizado.indicadoPor },
                            { $inc: { saldo: comissaoValor, comissao: comissaoValor } },
                            { new: true }
                        );
                        if (referrer) {
                            console.log(`💰 Comissão de afiliado: +R$ ${comissaoValor.toFixed(2)} para ${atualizado.indicadoPor} (indicou ${deposito.username})`);
                        } else {
                            console.log(`⚠️ Indicador não encontrado para comissão: ${atualizado.indicadoPor}`);
                        }
                    } catch (commErr) {
                        console.error(`❌ Erro ao creditar comissão para ${atualizado.indicadoPor}:`, commErr);
                    }
                }
            }
        } else {
            console.log(`❌ Usuário não encontrado: ${deposito.username}`);
        }

        res.json({ received: true });
    } catch (e) {
        console.error("❌ Erro no callback PIX:", e);
        res.status(500).json({ received: true, error: "Erro interno" });
    }
});

app.post("/api/register", registerLimiter, async (req, res) => {
    try {
        const { username, password, ref } = req.body;

        if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
            return res.status(400).json({ success: false, message: "Dados inválidos" });
        }

        const cleanUsername = username.trim().toLowerCase();

        if (!/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(cleanUsername)) {
            return res.status(400).json({ success: false, message: "Usuário inválido. Use apenas letras, números, _ ou -. Mínimo 3, máximo 30 caracteres." });
        }

        if (password.length < 3 || password.length > 128) {
            return res.status(400).json({ success: false, message: "Senha inválida" });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Gerar link de afiliado único (8 chars hex)
        let affiliateLink = null;
        let attempts = 0;
        while (!affiliateLink && attempts < 10) {
            const candidate = crypto.randomBytes(4).toString('hex');
            const exists = await User.findOne({ affiliateLink: candidate });
            if (!exists) affiliateLink = candidate;
            attempts++;
        }
        if (!affiliateLink) {
            return res.status(500).json({ success: false, message: "Erro interno ao gerar link de afiliado. Tente novamente." });
        }

        // Resolver indicador pelo código de afiliado (affiliateLink)
        let indicadoPor = null;
        if (ref && typeof ref === 'string') {
            const cleanRef = sanitizar(ref.trim().toLowerCase());
            const referrer = await User.findOne({ affiliateLink: cleanRef });
            if (referrer) indicadoPor = referrer.username;
        }

        const novo = new User({ username: cleanUsername, password: hashedPassword, affiliateLink, indicadoPor });
        await novo.save();
        res.json({ success: true });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ success: false, message: "Usuário já existe" });
        }
        res.status(400).json({ success: false, message: "Erro no cadastro" });
    }
});

app.post("/api/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    const cleanUsername = username?.trim()?.toLowerCase() || '';
    const user = await User.findOne({ username: cleanUsername });
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        return res.json({ success: true, username: user.username, saldo: user.saldo, affiliateLink: user.affiliateLink, token });
    }
    res.status(400).json({ success: false });
});

app.post("/api/aposta", apostaLimiter, autenticar, async (req, res) => {
    const { valor } = req.body;
    const username = req.usuario.username;
    if (!username || typeof valor !== 'number' || isNaN(valor) || !isFinite(valor) || valor <= 0 || valor > 10000) {
        return res.status(400).json({ success: false, message: "Dados inválidos" });
    }
    const valorAposta = Math.round(valor * 100) / 100;
    const ganhou = Math.random() < globalRTP;
    const atualizado = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase(), saldo: { $gte: valorAposta } },
        { $inc: { saldo: -valorAposta } },
        { new: true }
    );
    if (!atualizado) return res.status(400).json({ success: false, message: "Saldo insuficiente" });
    if (!ganhou && atualizado.indicadoPor) {
        await User.findOneAndUpdate({ username: atualizado.indicadoPor }, { $inc: { comissao: valorAposta * 0.10 } });
    }
    let premioToken = null;
    if (ganhou) {
        premioToken = crypto.randomBytes(32).toString('hex');
        await User.findOneAndUpdate({ username: username.trim().toLowerCase() }, { $set: { premioToken: premioToken, premioValor: valorAposta } });
    }
    res.json({ success: true, saldo: atualizado.saldo, ganhou, premioToken });
});

app.post("/api/premio", premioLimiter, autenticar, async (req, res) => {
    const username = req.usuario.username;
    const { premioToken } = req.body;
    const user = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase(), premioToken: premioToken, premioValor: { $ne: null } },
        { $set: { premioToken: null } },
        { new: false }
    );
    if (!user || !user.premioValor) return res.status(400).json({ success: false, message: "Token inválido" });
    const premio = user.premioValor * 10;
    const atualizado = await User.findOneAndUpdate({ username: username.trim().toLowerCase() }, { $inc: { saldo: premio }, $set: { premioValor: null } }, { new: true });
    res.json({ success: true, saldo: atualizado.saldo });
});

app.get("/api/saldo", autenticar, async (req, res) => {
    const user = await User.findOne({ username: req.usuario.username });
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, saldo: user.saldo, affiliateLink: user.affiliateLink });
});

app.get("/api/affiliate-stats", affiliateLimiter, autenticar, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.usuario.username });
        if (!user) return res.status(404).json({ success: false, message: "Usuário não encontrado" });
        
        // Contar quantos usuários foram indicados por este user
        const totalAmigos = await User.countDocuments({ indicadoPor: user.username });
        
        res.json({
            success: true,
            totalAmigos: totalAmigos,
            comissao: user.comissao || 0,
            totalSacado: user.comissaoSacada || 0,
            affiliateLink: user.affiliateLink
        });
    } catch (err) {
        console.error("Erro ao buscar stats de afiliado:", err);
        res.status(500).json({ success: false, message: "Erro interno" });
    }
});

app.post("/api/affiliate-withdraw", affiliateWithdrawLimiter, autenticar, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.usuario.username });
        if (!user) return res.status(404).json({ success: false, message: "Usuário não encontrado" });
        
        const comissao = user.comissao || 0;
        if (comissao <= 0) {
            return res.status(400).json({ success: false, message: "Sem comissão disponível para converter" });
        }
        
        // Transferir comissão para saldo e zerar comissão, incrementar comissaoSacada
        const atualizado = await User.findOneAndUpdate(
            { username: req.usuario.username, comissao: { $gte: comissao } },
            { 
                $inc: { saldo: comissao, comissaoSacada: comissao },
                $set: { comissao: 0 }
            },
            { new: true }
        );
        
        if (!atualizado) {
            return res.status(400).json({ success: false, message: "Erro ao converter comissão" });
        }
        
        res.json({
            success: true,
            valorConvertido: comissao,
            novoSaldo: atualizado.saldo,
            totalSacado: atualizado.comissaoSacada || 0
        });
    } catch (err) {
        console.error("Erro ao sacar comissão:", err);
        res.status(500).json({ success: false, message: "Erro interno" });
    }
});

app.post("/api/solicitar-saque", saqueLimiter, autenticar, async (req, res) => {
    const { valor, pix } = req.body;
    const username = req.usuario.username;

    if (typeof valor !== 'number' || isNaN(valor) || !isFinite(valor) || valor < 1 || valor > 50000) {
        return res.status(400).json({ success: false, message: "Valor de saque inválido" });
    }
    if (!pix || typeof pix !== 'string' || pix.trim().length < 5 || pix.trim().length > 300) {
        return res.status(400).json({ success: false, message: "Chave PIX inválida" });
    }

    const valorSaque = Math.round(valor * 100) / 100;
    const chavePix = sanitizar(pix.trim());

    const atualizado = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase(), saldo: { $gte: valorSaque } },
        { $inc: { saldo: -valorSaque } },
        { new: true }
    );
    if (!atualizado) return res.status(400).json({ success: false, message: "Saldo insuficiente" });

    await new Saque({ username: atualizado.username, valor: valorSaque, chavePix: chavePix }).save();
    res.json({ success: true, saldo: atualizado.saldo });
});

app.post("/admin/usuarios", adminLimiter, async (req, res) => {
    if (!verificarSenhaAdmin(req.body.senha)) return res.status(403).json({ success: false });
    const users = await User.find({}, 'username saldo indicadoPor comissao').sort({ saldo: -1 });
    res.json({ success: true, usuarios: users });
});

app.post("/admin/saques-pendentes", adminLimiter, async (req, res) => {
    if (!verificarSenhaAdmin(req.body.senha)) return res.status(403).json({ success: false });
    const saques = await Saque.find({ status: "pendente" });
    res.json({ success: true, saques });
});

app.post("/admin/set-rtp", adminLimiter, (req, res) => {
    if (!verificarSenhaAdmin(req.body.senha)) return res.status(403).json({ success: false });
    const rtp = parseFloat(req.body.rtp);
    if (isNaN(rtp) || !isFinite(rtp) || rtp < 0 || rtp > 1) {
        return res.status(400).json({ success: false, message: "RTP deve ser entre 0 e 1" });
    }
    globalRTP = rtp;
    res.json({ success: true });
});

app.post("/admin/get-rtp", adminLimiter, (req, res) => {
    if (!verificarSenhaAdmin(req.body.senha)) return res.status(403).json({ success: false });
    res.json({ success: true, rtp: globalRTP });
});

app.post("/admin/add-saldo", adminLimiter, async (req, res) => {
    if (!verificarSenhaAdmin(req.body.senha)) return res.status(403).json({ success: false });
    const { username, valor } = req.body;
    if (!username || typeof username !== 'string') return res.status(400).json({ success: false, message: "Usuário inválido" });
    const valorAdd = parseFloat(valor);
    if (isNaN(valorAdd) || !isFinite(valorAdd)) return res.status(400).json({ success: false, message: "Valor inválido" });
    await User.findOneAndUpdate({ username: username.trim().toLowerCase() }, { $inc: { saldo: valorAdd } });
    res.json({ success: true });
});

app.post("/admin/financeiro", adminLimiter, async (req, res) => {
    if (!verificarSenhaAdmin(req.body.senha)) return res.status(403).json({ success: false });
    const [depositoResult, saqueResult] = await Promise.all([
        Deposito.aggregate([{ $match: { status: "pago" } }, { $group: { _id: null, total: { $sum: "$valor" } } }]),
        Saque.aggregate([{ $match: { status: { $in: ["aprovado", "pago"] } } }, { $group: { _id: null, total: { $sum: "$valor" } } }])
    ]);
    const totalDepositos = depositoResult[0]?.total || 0;
    const totalSaques = saqueResult[0]?.total || 0;
    const ggr = totalDepositos - totalSaques;
    res.json({ success: true, totalDepositos, totalSaques, ggr });
});

app.listen(process.env.PORT || 10000, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${process.env.PORT || 10000}`);
});
