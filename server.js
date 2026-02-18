const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const axios = require("axios"); // IMPORTANTE: instale com npm install axios

const app = express();

// --- CONFIGURAÇÕES ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, ".")));

// --- CREDENCIAIS SUITPAY (Configure no Render para sua segurança) ---
const SUITPAY_ID = process.env.SUITPAY_ID || "COLE_AQUI_SEU_CI_SE_NAO_USAR_RENDER";
const SUITPAY_SECRET = process.env.SUITPAY_SECRET || "COLE_AQUI_SEU_CS_SE_NAO_USAR_RENDER";
const SUITPAY_URL = "https://api.suitpay.app";

// --- VARIÁVEL GLOBAL DE RTP ---
let globalRTP = 0.95; 

// --- CONEXÃO COM O MONGODB ---
const MONGO_URI = "mongodb+srv://joaoprofvitor:qFmbWQW1ckquJ5Ql@cluster0.mavkxio.mongodb.net/tacada?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ CONEXÃO ESTABELECIDA COM O MONGODB!"))
    .catch(err => console.error("❌ FALHA CRÍTICA NA CONEXÃO:", err));

// --- MODELO DE USUÁRIO ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    depositoInicial: { type: Number, default: 0 } 
});
const User = mongoose.model("User", UserSchema);

// --- ROTAS DA SUITPAY (DEPÓSITO E WEBHOOK) ---

// 1. GERA O PIX PARA O JOGADOR
app.post("/api/gerar-deposito", async (req, res) => {
    const { username, valor } = req.body;
    try {
        const response = await axios.post(`${SUITPAY_URL}/gateway/pix-payment`, {
            requestNumber: `dep_${Date.now()}_${username}`,
            dueDate: new Date(Date.now() + 3600000).toISOString().split('T')[0],
            amount: parseFloat(valor),
            callbackUrl: `https://${req.get('host')}/api/webhook-suitpay`,
            client: {
                name: username,
                document: "00000000000" // CPF genérico ou use um real se coletar
            }
        }, {
            headers: { 'ci': SUITPAY_ID, 'cs': SUITPAY_SECRET }
        });

        if (response.data.response === "OK") {
            res.json({ 
                success: true, 
                copyPaste: response.data.pixCode, 
                qrCode: response.data.qrcodeBase64 
            });
        } else {
            res.status(400).json({ success: false, msg: response.data.response });
        }
    } catch (err) {
        console.error("Erro Suitpay:", err.message);
        res.status(500).json({ success: false, msg: "Erro ao gerar Pix" });
    }
});

// 2. RECEBE A CONFIRMAÇÃO DO PAGAMENTO (AUTOMÁTICO)
app.post("/api/webhook-suitpay", async (req, res) => {
    const { status, requestNumber, amount } = req.body;
    console.log(`📡 Webhook recebido: ${status} para ${requestNumber}`);

    if (status === "PAID") {
        // Extrai o username que colocamos no requestNumber lá em cima
        const parts = requestNumber.split('_');
        const username = parts[2]; 

        const usuario = await User.findOneAndUpdate(
            { username: username },
            { $inc: { saldo: parseFloat(amount) } },
            { new: true }
        );
        
        if (usuario) console.log(`💰 Saldo atualizado para ${username}: +R$ ${amount}`);
    }
    res.sendStatus(200);
});

// 3. ROTA DE SAQUE (LÓGICA INICIAL)
app.post("/api/solicitar-saque", async (req, res) => {
    const { username, valor, chavePix } = req.body;
    const user = await User.findOne({ username });

    if (user && user.saldo >= valor) {
        // Desconta do saldo e você paga manualmente no painel Suitpay ou via API de saída
        await User.findOneAndUpdate({ username }, { $inc: { saldo: -valor } });
        console.log(`💸 SAQUE SOLICITADO: ${username} | R$ ${valor} | Chave: ${chavePix}`);
        return res.json({ success: true, msg: "Saque solicitado com sucesso!" });
    }
    res.status(400).json({ success: false, msg: "Saldo insuficiente" });
});

// --- RESTANTE DAS SUAS ROTAS ORIGINAIS (MANTIDAS) ---

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/jogo.html", (req, res) => res.sendFile(path.join(__dirname, "jogo.html")));

app.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const novoUsuario = new User({ username: username.trim(), password: hashedPassword });
        await novoUsuario.save();
        res.json({ success: true, msg: "Cadastro realizado!" });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const usuario = await User.findOne({ username: username.trim() });
        if (!usuario) return res.status(401).json({ success: false });
        const senhaValida = await bcrypt.compare(password, usuario.password);
        if (!senhaValida) return res.status(401).json({ success: false });
        res.json({ success: true, username: usuario.username, saldo: usuario.saldo });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/update-saldo", async (req, res) => {
    try {
        const { username, valor } = req.body;
        const usuario = await User.findOneAndUpdate({ username }, { $inc: { saldo: valor } }, { new: true });
        res.json({ success: true, novoSaldo: usuario.saldo });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Admin rotas... (Set RTP, Add Saldo manual, etc)
app.get("/admin/get-rtp", (req, res) => res.json({ rtp: globalRTP }));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
