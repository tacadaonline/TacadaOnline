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

// --- CREDENCIAIS (SUBSTITUA SE NECESSÁRIO) ---
const SUITPAY_ID = process.env.SUITPAY_ID || "COLE_SEU_CI_AQUI";
const SUITPAY_SECRET = process.env.SUITPAY_SECRET || "COLE_SEU_CS_AQUI";
const SUITPAY_URL = "https://api.suitpay.app";

// CONFIGURAÇÃO DO ADMIN
const ADMIN_PASSWORD_FIXA = "admin123"; 
let globalRTP = 0.95; 

// --- CONEXÃO COM O MONGODB ---
const MONGO_URI = "mongodb+srv://joaoprofvitor:qFmbWQW1ckquJ5Ql@cluster0.mavkxio.mongodb.net/tacada?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MONGODB CONECTADO COM SUCESSO!"))
    .catch(err => console.error("❌ ERRO AO CONECTAR MONGODB:", err));

// --- MODELO DE USUÁRIO ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    saldo: { type: Number, default: 0 },
    depositoInicial: { type: Number, default: 0 } 
});
const User = mongoose.model("User", UserSchema);

// --- ROTAS ADMIN (SINCRONIZADAS COM O ADMIN.HTML) ---

// 1. Listar todos os jogadores
app.post("/admin/usuarios", async (req, res) => {
    const { senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) {
        return res.status(403).json({ success: false, msg: "Senha incorreta" });
    }
    try {
        const usuarios = await User.find({}, { password: 0 }); // Esconde a senha por segurança
        res.json({ success: true, usuarios: usuarios });
    } catch (err) {
        res.status(500).json({ success: false, msg: "Erro no banco de dados" });
    }
});

// 2. Alterar RTP (Dificuldade)
app.post("/admin/set-rtp", (req, res) => {
    const { rtp, senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    
    globalRTP = parseFloat(rtp);
    console.log(`⚙️ Novo RTP: ${globalRTP}`);
    res.json({ success: true });
});

// 3. Adicionar Saldo Manual
app.post("/admin/add-saldo", async (req, res) => {
    const { username, valor, senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    
    try {
        await User.findOneAndUpdate({ username }, { $inc: { saldo: parseFloat(valor) } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 4. Zerar Saldo (Pagar Saque)
app.post("/admin/pagar-saque", async (req, res) => {
    const { username, senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    
    try {
        await User.findOneAndUpdate({ username }, { $set: { saldo: 0 } });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 5. Consulta de RTP para o Jogo
app.get("/admin/get-rtp", (req, res) => res.json({ rtp: globalRTP }));

// --- ROTAS DE LOGIN E CADASTRO ---

app.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const novoUsuario = new User({ username: username.trim().toLowerCase(), password: hashedPassword });
        await novoUsuario.save();
        res.json({ success: true, msg: "Cadastro realizado!" });
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

app.post("/update-saldo", async (req, res) => {
    try {
        const { username, valor } = req.body;
        const usuario = await User.findOneAndUpdate({ username }, { $inc: { saldo: valor } }, { new: true });
        res.json({ success: true, novoSaldo: usuario.saldo });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- FINANCEIRO SUITPAY (DEPÓSITOS) ---

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
        const parts = requestNumber.split('_');
        const username = parts[2]; 
        await User.findOneAndUpdate({ username }, { $inc: { saldo: parseFloat(amount) } });
    }
    res.sendStatus(200);
});

// --- INICIALIZAÇÃO ---
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 SERVIDOR RODANDO NA PORTA ${PORT}`));
