const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Banco de dados temporário (Simulado)
const usuarios = [
    { user: "admin", pass: "12345", saldo: 1000.00 }
];

// Rota de Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const usuario = usuarios.find(u => u.user === username && u.pass === password);

    if (usuario) {
        res.json({ success: true, saldo: usuario.saldo, msg: "Bem-vindo!" });
    } else {
        res.status(401).json({ success: false, msg: "Usuário ou senha incorretos." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
