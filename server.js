const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const app = express();

// --- CONFIGURAÇÕES ---
app.use(cors());
app.use(express.json());
// Serve arquivos estáticos da pasta raiz
app.use(express.static(path.join(__dirname, ".")));

// --- CONEXÃO COM O MONGODB ---
const MONGO_URI = "mongodb+srv://joaoprofvitor:maeteamo123@cluster0.mavkxio.mongodb.net/tacada?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000 // Desiste após 5s se o banco não responder
})
.then(() => console.log("✅ BANCO DE DADOS CONECTADO!"))
.catch(err => console.error("❌ ERRO AO CONECTAR BANCO:", err));

// --- MODELO DE USUÁRIO ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    saldo: { type: Number, default: 0 }
});
const User = mongoose.model("User", UserSchema);

// --- ROTAS DE PÁGINAS ---
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/cadastro.html", (req, res) => res.sendFile(path.join(__dirname, "cadastro.html")));
app.get("/jogo.html", (req, res) => res.sendFile(path.join(__dirname, "jogo.html")));

// --- ROTA DE CADASTRO ---
app.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, msg: "Preencha tudo!" });

        const userClean = username.trim();
        const existe = await User.findOne({ username: userClean });
        if (existe) return res.status(400).json({ success: false, msg: "Usuário já existe!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const novoUsuario = new User({ username: userClean, password: hashedPassword });
        await novoUsuario.save();

        return res.json({ success: true, msg: "Cadastro realizado!" });
    } catch (err) {
        console.error("ERRO NO REGISTER:", err);
        return res.status(500).json({ success: false, msg: "Erro interno no servidor" });
    }
});

// --- ROTA DE LOGIN ---
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const userClean = username.trim();
        const usuario = await User.findOne({ username: userClean });

        if (!usuario) return res.status(401).json({ success: false, msg: "Usuário não encontrado" });

        const senhaValida = await bcrypt.compare(password, usuario.password);
        if (!senhaValida) return res.status(401).json({ success: false, msg: "Senha incorreta" });

        return res.json({ 
            success: true, 
            saldo: usuario.saldo, 
            msg: "Login realizado!" 
        });
    } catch (err) {
        console.error("ERRO NO LOGIN:", err);
        return res.status(500).json({ success: false, msg: "Erro no login" });
    }
});

// --- INICIALIZAÇÃO (AJUSTE PARA RENDER) ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
