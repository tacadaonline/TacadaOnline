const express = require('express');
const cors = require('cors');
const app = express();

// Configuração de CORS completa para evitar bloqueios no navegador
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Banco de dados temporário
const usuarios = [
    { user: "admin", pass: "123", saldo: 1000.00 }
];

// Rota inicial para teste (Agora não vai mais dar "Cannot GET /")
app.get('/', (req, res) => {
    res.send('Servidor do Tacada Online está ATIVO e operando!');
});

// Rota de Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const usuario = usuarios.find(u => u.user === username && u.pass === password);

    if (usuario) {
        res.json({ 
            success: true, 
            saldo: usuario.saldo, 
            msg: "Bem-vindo ao jogo!" 
        });
    } else {
        res.status(401).json({ 
            success: false, 
            msg: "Usuário ou senha incorretos." 
        });
    }
});

// Porta dinâmica para o Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
