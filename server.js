const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const app = express();

// --- CONFIGURAÇÕES ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, ".")));

// --- CONEXÃO COM O MONGODB ---
const MONGO_URI = "mongodb+srv://joaoprofvitor:qFmbWQW1ckquJ5Ql@cluster0.mavkxio.mongodb.net/tacada?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ CONEXÃO ESTABELECIDA COM O MONGODB!"))
    .catch(err => console.error("❌ FALHA CRÍTICA NA CONEXÃO:", err));

// --- MODELO DE USUÁRIO ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    saldo: { type: Number, default: 100 } // Definido saldo inicial de 100 para novos jogadores
});
const User = mongoose.model("User", UserSchema);

// --- MIDDLEWARE DE CHECAGEM DE BANCO ---
app.use((req, res, next) => {
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ success: false, msg: "Banco de dados conectando..." });
    }
    next();
});

// --- ROTAS DE PÁGINAS ---
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/cadastro.html", (req, res) => res.sendFile(path.join(__dirname, "cadastro.html")));
app.get("/jogo.html", (req, res) => res.sendFile(path.join(__dirname, "index.html"))); // Ajustado para seu index

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
        return res.status(500).json({ success: false, msg: "Erro ao salvar no banco." });
    }
});

// --- ROTA DE LOGIN ---
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const usuario = await User.findOne({ username: username.trim() });

        if (!usuario) return res.status(401).json({ success: false, msg: "Usuário não encontrado" });

        const senhaValida = await bcrypt.compare(password, usuario.password);
        if (!senhaValida) return res.status(401).json({ success: false, msg: "Senha incorreta" });

        // IMPORTANTE: Enviando saldo para o jogo
        return res.json({ 
            success: true, 
            username: usuario.username, 
            saldo: usuario.saldo, 
            msg: "Sucesso!" 
        });
    } catch (err) {
        return res.status(500).json({ success: false, msg: "Erro no login" });
    }
});

// --- ROTA PARA ATUALIZAR SALDO (GANHOS E PERDAS) ---
app.post("/update-saldo", async (req, res) => {
    try {
        const { username, valor } = req.body;
        
        // Busca o usuário e incrementa o saldo (valor pode ser positivo ou negativo)
        const usuario = await User.findOneAndUpdate(
            { username: username },
            { $inc: { saldo: valor } },
            { new: true } // Retorna o documento atualizado
        );

        if (!usuario) return res.status(404).json({ success: false, msg: "Usuário não encontrado" });

        return res.json({ success: true, novoSaldo: usuario.saldo });
    } catch (err) {
        console.error("Erro ao atualizar saldo:", err);
        return res.status(500).json({ success: false, msg: "Erro no servidor" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
