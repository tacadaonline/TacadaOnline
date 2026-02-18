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
const SUITPAY_ID = process.env.SUITPAY_ID || "SEU_CI_AQUI";
const SUITPAY_SECRET = process.env.SUITPAY_SECRET || "SEU_CS_AQUI";
const SUITPAY_URL = "https://api.suitpay.app";

// SENHA DO PAINEL ADMIN (MUDE AQUI SE QUISER)
const ADMIN_PASSWORD_FIXA = "admin123"; 

// VARIÁVEL GLOBAL DE RTP
let globalRTP = 0.95; 

// --- CONEXÃO MONGODB ---
const MONGO_URI = "mongodb+srv://joaoprofvitor:qFmbWQW1ckquJ5Ql@cluster0.mavkxio.mongodb.net/tacada?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MONGODB CONECTADO!"))
    .catch(err => console.error("❌ ERRO MONGODB:", err));

// --- MODELO DE USUÁRIO ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    dataCadastro: { type: Date, default: Date.now }
});
const User = mongoose.model("User", UserSchema);

// --- ROTAS ADMIN (PARA O SEU PAINEL FUNCIONAR) ---

// 1. Rota que retorna a lista de jogadores para a tabela
app.get("/admin/usuarios", async (req, res) => {
    try {
        const usuarios = await User.find({}, { password: 0 }).sort({ dataCadastro: -1 });
        res.json(usuarios);
    } catch (err) {
        res.status(500).json({ error: "Erro ao buscar lista" });
    }
});

// 2. Rota para alterar o RTP via painel
app.post("/admin/set-rtp", (req, res) => {
    const { rtp, senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ msg: "Senha Inválida" });
    
    globalRTP = parseFloat(rtp);
    res.json({ success: true, novoRTP: globalRTP });
});

// 3. Rota que o jogo consulta para saber a dificuldade
app.get("/admin/get-rtp", (req, res) => res.json({ rtp: globalRTP }));

// --- ROTAS DE JOGO E LOGIN ---

app.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const novoUsuario = new User({ username: username.trim().toLowerCase(), password: hashedPassword });
        await novoUsuario.save();
        res.json({ success: true, msg: "Cadastrado!" });
    } catch (err) { res.status(500).json({ success: false, msg: "Usuário já existe" }); }
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

// Atualiza saldo após a partida (Win/Loss)
app.post("/update-saldo", async (req, res) => {
    try {
        const { username, valor } = req.body;
        const usuario = await User.findOneAndUpdate({ username }, { $inc: { saldo: valor } }, { new: true });
        res.json({ success: true, novoSaldo: usuario.saldo });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- FINANCEIRO SUITPAY ---

app.post("/api/gerar-deposito", async (req, res) => {
    const { username, valor } = req.body;
    try {
        const response = await axios.post(`${SUITPAY_URL}/gateway/pix-payment`, {
            requestNumber: `dep_${Date.now()}_${username}`,
            dueDate: new Date(Date.now() + 3600000).toISOString().split('T')[0],
            amount: parseFloat(valor),
            callbackUrl: `https://${req.get('host')}/api/webhook-suitpay`,
            client: { name: username, document: "00000000000" }
        }, { headers: { 'ci': SUITPAY_ID, 'cs': SUITPAY_SECRET } });

        res.json({ success: true, copyPaste: response.data.pixCode, qrCode: response.data.qrcodeBase64 });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post("/api/webhook-suitpay", async (req, res) => {
    const { status, requestNumber, amount } = req.body;
    if (status === "PAID") {
        const username = requestNumber.split('_')[2];
        await User.findOneAndUpdate({ username }, { $inc: { saldo: parseFloat(amount) } });
    }
    res.sendStatus(200);
});

// --- INICIALIZAÇÃO ---
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVIDOR ON NA PORTA ${PORT}`));
