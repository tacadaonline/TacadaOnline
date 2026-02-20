require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const app = express();

// --- CONFIGURAÇÕES INICIAIS ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, ".")));

// VARIÁVEIS DE AMBIENTE (Configure no painel do Render)
const MONGO_URI = process.env.MONGO_URI; 
const ADMIN_PASSWORD_FIXA = process.env.ADMIN_PASS || "mude-isso-no-env"; 

let globalRTP = 0.30; // 30% de chance de vitória (ajuste conforme desejar)

// --- CONEXÃO BANCO DE DADOS ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ BANCO CONECTADO!"))
    .catch(err => console.error("❌ ERRO BANCO:", err));

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    saldo: { type: Number, default: 0 }
});
const User = mongoose.model("User", UserSchema);

// --- 🔐 ROTA DE CADASTRO ---
app.post("/api/register", async (req, res) => {
    try {
        const { username, password } = req.body;
        const userLower = username.trim().toLowerCase();
        
        const existe = await User.findOne({ username: userLower });
        if (existe) return res.status(400).json({ success: false, message: "Usuário já cadastrado!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const novoUsuario = new User({ username: userLower, password: hashedPassword, saldo: 0 });
        await novoUsuario.save();
        
        res.json({ success: true, message: "Cadastro realizado!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro ao cadastrar." });
    }
});

// --- 🔑 ROTA DE LOGIN ---
app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, message: "Dados incompletos" });

        const userLower = username.trim().toLowerCase();
        const usuario = await User.findOne({ username: userLower });
        
        if (!usuario) return res.status(400).json({ success: false, message: "Usuário não encontrado." });

        const senhaValida = await bcrypt.compare(password, usuario.password);
        if (!senhaValida) return res.status(400).json({ success: false, message: "Senha incorreta." });

        res.json({ success: true, username: usuario.username, saldo: usuario.saldo });
    } catch (err) {
        res.status(500).json({ success: false, message: "Erro interno no servidor." });
    }
});

// --- 💰 ROTA DE SALDO ---
app.get("/api/saldo", async (req, res) => {
    try {
        const { user } = req.query;
        if (!user) return res.status(400).json({ success: false });
        
        const usuario = await User.findOne({ username: user.trim().toLowerCase() });
        if (!usuario) return res.status(404).json({ success: false });
        
        res.json({ success: true, saldo: usuario.saldo });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// --- 🎲 LÓGICA DE APOSTA (SERVER-SIDE) ---
app.post("/api/aposta", async (req, res) => {
    try {
        const { username, valor } = req.body;
        const valorAposta = parseFloat(valor);

        if (!username || isNaN(valorAposta) || valorAposta <= 0) {
            return res.status(400).json({ success: false, message: "Dados inválidos" });
        }

        const usuario = await User.findOne({ username: username.trim().toLowerCase() });
        if (!usuario || usuario.saldo < valorAposta) {
            return res.status(400).json({ success: false, message: "Saldo insuficiente" });
        }

        // SORTEIO RTP
        const ganhou = Math.random() < globalRTP;
        
        // Se o jogo é 3.0x: se ele ganha, recebe o valor da aposta * 3.
        // Como o saldo vai ser atualizado, o lucro real adicionado é (valor * 2).
        // Se perde, removemos o valor da aposta.
        let mudancaSaldo = ganhou ? (valorAposta * 2) : -valorAposta;

        const usuarioAtualizado = await User.findOneAndUpdate(
            { username: username.trim().toLowerCase() },
            { $inc: { saldo: mudancaSaldo } },
            { new: true }
        );

        res.json({ 
            success: true, 
            saldo: usuarioAtualizado.saldo,
            ganhou: ganhou
        });

    } catch (err) { 
        res.status(500).json({ success: false, message: "Erro interno no servidor" }); 
    }
});

// --- ⚙️ ADMIN RTP ---
app.get("/admin/get-rtp", (req, res) => {
    res.json({ rtp: globalRTP });
});

// --- 📥 ADICIONAR SALDO (ADMIN) ---
app.post("/admin/add-saldo", async (req, res) => {
    const { username, valor, senha } = req.body;
    if (senha !== ADMIN_PASSWORD_FIXA) return res.status(403).json({ success: false });
    
    const usuario = await User.findOneAndUpdate(
        { username: username.trim().toLowerCase() }, 
        { $inc: { saldo: parseFloat(valor) } }, 
        { new: true }
    );
    res.json({ success: true, novoSaldo: usuario?.saldo });
});

// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SERVIDOR TACADA ONLINE RODANDO NA PORTA ${PORT}`);
});
