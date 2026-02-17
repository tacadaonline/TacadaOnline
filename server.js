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

// --- CONEXÃO COM O MONGODB (SEU LINK APLICADO) ---
const MONGO_URI = "mongodb+srv://joaoprofvitor:maeteamo123@cluster0.mavkxio.mongodb.net/tacada?retryWrites=true&w=majority";
// Nota: Usei %2F no lugar da barra na senha para evitar erro de leitura do link.

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ BANCO DE DADOS CONECTADO COM SUCESSO!"))
    .catch(err => console.error("❌ ERRO AO CONECTAR BANCO:", err));

// --- MODELO DE USUÁRIO (BLINDAGEM DE DADOS) ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    saldo: { type: Number, default: 0 }
});
const User = mongoose.model("User", UserSchema);

// --- ROTAS DE PÁGINAS ---
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/cadastro.html", (req, res) => res.sendFile(path.join(__dirname, "cadastro.html")));
app.get("/jogo.html", (req, res) => res.sendFile(path.join(__dirname, "jogo.html")));

// --- ROTA DE CADASTRO (SALVANDO NO BANCO) ---
app.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, msg: "Preencha tudo!" });

        const existe = await User.findOne({ username });
        if (existe) return res.status(400).json({ success: false, msg: "Usuário já existe!" });

        // Criptografia da senha
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const novoUsuario = new User({ username, password: hashedPassword });
        await novoUsuario.save();

        res.json({ success: true, msg: "Cadastro realizado!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: "Erro interno no servidor" });
    }
});

// --- ROTA DE LOGIN (COMPARANDO COM O BANCO) ---
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const usuario = await User.findOne({ username });

        if (!usuario) return res.status(401).json({ success: false, msg: "Usuário não encontrado" });

        // Compara senha digitada com a criptografada
        const senhaValida = await bcrypt.compare(password, usuario.password);
        if (!senhaValida) return res.status(401).json({ success: false, msg: "Senha incorreta" });

        res.json({ 
            success: true, 
            saldo: usuario.saldo, 
            msg: "Login realizado com sucesso!" 
        });
    } catch (err) {
        res.status(500).json({ success: false, msg: "Erro no login" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
