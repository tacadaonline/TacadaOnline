const axios = require('axios');

const bspayService = {
  gerarPix: async (dados) => {
    try {
      // AJUSTE NA URL ABAIXO: Adicionado /v2/pix/payment
      const response = await axios.post('https://api.bspay.co', {
        name: dados.nome,
        taxId: dados.cpf.replace(/\D/g, ''), // Limpa o CPF (tira pontos e traços)
        value: dados.valor,
        postbackUrl: `${process.env.CORS_ORIGIN}/webhook/bspay`
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.BSPAY_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      return response.data;
    } catch (error) {
      // Isso vai aparecer nos logs do Render se algo der errado
      console.error("Erro detalhado da BSPAY:", error.response?.data || error.message);
      throw new Error("Erro ao gerar PIX: Verifique os dados ou o token.");
    }
  }
};

module.exports = bspayService;
