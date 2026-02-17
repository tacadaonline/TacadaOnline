const express = require("express");
const cors = require("cors");

const app = express();

/* ===============================
   CONFIGURAÇÕES GERAIS
================================ */
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

/* ===============================
   BANCO DE DADOS TEMPORÁRIO
================================ */
const usuarios = [
    { user: "admin", pass: "123", saldo: 1000 }
];

/* ===============================
   ROTA DE TESTE
================================ */
app.get("/", (req, res) => {
    res.json({
        status: "online",
        msg: "Servidor do Tacada Online está ATIVO"
    });
});

/* ===============================
   ROTA DE LOGIN
================================ */
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            msg: "Usuário e senha são obrigatórios"
        });
    }

    const usuario = usuarios.find(
        u => u.user === username && u.pass === password
    );

    if (!usuario) {
        return res.status(401).json({
            success: false,
            msg: "Usuário ou senha incorretos"
        });
    }

    res.json({
        success: true,
        saldo: usuario.saldo,
        msg: "Login realizado com sucesso"
    });
});

/* ===============================
   START DO SERVIDOR (RENDER)
================================ */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
