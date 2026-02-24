const axios = require('axios');

const bspayService = {
  /**
   * Função para gerar cobrança PIX na BSPAY
   * @param {Object} dados - Contém { nome, cpf, valor }
   */
  gerarPix: async (dados) => {
    try {
      // URL oficial da BSPAY v2 para pagamentos PIX
      const url = 'https://api.bspay.co';

      // Configuração dos Headers com o Token do Render
      const config = {
        headers: {
          'Authorization': `Bearer ${process.env.BSPAY_TOKEN}`,
          'Content-Type': 'application/json'
        }
      };

      // Montagem do corpo da requisição (Payload)
      const body = {
        name: dados.nome, // Aqui passamos o username do jogador
        taxId: dados.cpf.replace(/\D/g, ''), // Remove pontos/traços do CPF
        value: parseFloat(dados.valor),
        // O Render precisa dessa URL para receber a confirmação automática
        postbackUrl: `https://tacadaonline-beckend.onrender.com`
      };

      const response = await axios.post(url, body, config);

      // Retornamos os dados da API (contendo qrcode, copyPaste, etc)
      return response.data;

    } catch (error) {
      // Log detalhado que aparecerá no painel do Render em caso de erro
      console.error("ERRO DETALHADO BSPAY:", error.response?.data || error.message);
      
      // Lança o erro com a mensagem vinda da API ou uma genérica
      const msgErro = error.response?.data?.message || "Falha na comunicação com a API de pagamento.";
      throw new Error(msgErro);
    }
  }
};

module.exports = bspayService;
