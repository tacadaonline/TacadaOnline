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

// --- VARIÁVEL GLOBAL DE RTP (DIFICULDADE) ---
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
    depositoInicial: { type: Number, default: 0 } // Para controlar o dobro do saque
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
app.get("/jogo.html", (req, res) => res.sendFile(path.join(__dirname, "jogo.html")));
app.get("/deposito.html", (req, res) => res.sendFile(path.join(__dirname, "deposito.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));

// --- ROTAS DO PAINEL ADMIN ---
app.post("/admin/set-rtp", (req, res) => {
    const { novoRTP, senha } = req.body;
    if (senha === "12345") { 
        globalRTP = parseFloat(novoRTP);
        return res.json({ success: true, rtp: globalRTP });
    }
    res.status(403).json({ success: false, msg: "Senha incorreta" });
});

app.get("/admin/get-rtp", (req, res) => {
    res.json({ rtp: globalRTP });
});

// LISTAR JOGADORES NO PAINEL
app.post("/admin/usuarios", async (req, res) => {
    const { senha } = req.body;
    if (senha === "12345") {
        const lista = await User.find({}, "username saldo depositoInicial");
        return res.json({ success: true, usuarios: lista });
    }
    res.status(403).json({ success: false });
});

// ZERAR SALDO APÓS PAGAMENTO
app.post("/admin/pagar-saque", async (req, res) => {
    const { username, senha } = req.body;
    if (senha === "12345") {
        await User.findOneAndUpdate({ username }, { saldo: 0, depositoInicial: 0 });
        return res.json({ success: true, msg: "Saldo zerado com sucesso!" });
    }
    res.status(403).json({ success: false });
});

// --- ROTA DE LOGIN ---
app.post("/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const usuario = await User.findOne({ username: username.trim() });
        if (!usuario) return res.status(401).json({ success: false, msg: "Usuário não encontrado" });
        const senhaValida = await bcrypt.compare(password, usuario.password);
        if (!senhaValida) return res.status(401).json({ success: false, msg: "Senha incorreta" });
        return res.json({ success: true, username: usuario.username, saldo: usuario.saldo });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- ROTA DE CADASTRO ---
app.post("/register", async (req, res) => {
    try {
        const { username, password } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const novoUsuario = new User({ username: username.trim(), password: hashedPassword });
        await novoUsuario.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- ATUALIZAR SALDO ---
app.post("/update-saldo", async (req, res) => {
    try {
        const { username, valor } = req.body;
        const usuario = await User.findOneAndUpdate(
            { username: username },
            { $inc: { saldo: valor } },
            { new: true }
        );
        res.json({ success: true, novoSaldo: usuario.saldo });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- ROTA DE SOLICITAR SAQUE (COM REGRA DO DOBRO) ---
app.post("/solicitar-saque", async (req, res) => {
    try {
        const { username } = req.body;
        const usuario = await User.findOne({ username });
        
        const meta = usuario.depositoInicial * 2;
        
        if (usuario.saldo < meta || usuario.saldo <= 0) {
            return res.json({ 
                success: false, 
                msg: `Para sacar, seu saldo deve ser o dobro do depósito (Mínimo: R$ ${meta.toFixed(2)})` 
            });
        }

        res.json({ success: true, msg: "Saque solicitado! Aguarde o pagamento do administrador." });
    } catch (err) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor na porta ${PORT}`));
