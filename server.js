const express = require("express");
const cors = require("cors");
const path = require("path"); // 1. Adicione isso aqui

const app = express();

app.use(cors());
app.use(express.json());

// 2. Configuração para servir arquivos estáticos (CSS, Imagens, JS do front)
// Se o seu login.html estiver na raiz, use '.' ou remova se preferir apenas o sendFile
app.use(express.static(path.join(__dirname, ".")));

/* ===============================
   BANCO DE DADOS TEMPORÁRIO
================================ */
const usuarios = [
    { user: "admin", pass: "123", saldo: 1000 }
];

/* ===============================
   ROTA PRINCIPAL (AQUI ESTAVA O ERRO)
================================ */
app.get("/", (req, res) => {
    // Em vez de res.json, enviamos o arquivo HTML
    res.sendFile(path.join(__dirname, "login.html"));
});

/* ===============================
   ROTA DE LOGIN (MANTIDA)
================================ */
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const usuario = usuarios.find(u => u.user === username && u.pass === password);

    if (!usuario) {
        return res.status(401).json({ success: false, msg: "Usuário ou senha incorretos" });
    }

    res.json({ success: true, saldo: usuario.saldo, msg: "Login realizado com sucesso" });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
