const axios = require('axios');

const bspayService = {
  /**
   * Gera cobrança PIX na BSPAY
   * @param {Object} dados - { nome, cpf, valor }
   */
  gerarPix: async (dados) => {
    try {
      const url = 'https://api.bspay.co';
      
      // IMPORTANTE: O User-Agent ajuda a evitar o erro 403 Forbidden em alguns firewalls
      const config = {
        headers: {
          'Authorization': `Bearer ${process.env.BSPAY_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };

      const body = {
        name: dados.nome, // Username do jogador
        taxId: dados.cpf.replace(/\D/g, '') || "00000000000", 
        value: parseFloat(dados.valor),
        // Certifique-se de que esta URL é a do seu Render
        postbackUrl: `https://tacadaonline-beckend.onrender.com`
      };

      // Log para debug no Render (remover em produção se desejar)
      console.log(`[BSPAY] Tentando gerar PIX para: ${dados.nome} - Valor: ${dados.valor}`);

      const response = await axios.post(url, body, config);
      return response.data;

    } catch (error) {
      // Captura o erro detalhado para aparecer no log do Render
      const erroStatus = error.response?.status;
      const erroData = error.response?.data;

      console.error(`[BSPAY ERROR] Status: ${erroStatus}`);
      console.error("Conteúdo do Erro:", erroData || error.message);

      if (erroStatus === 403) {
        throw new Error("Erro 403: A BSPAY bloqueou a conexão do servidor (Firewall/IP).");
      }
      
      throw new Error(erroData?.message || "Falha na comunicação com a API de pagamento.");
    }
  }
};

module.exports = bspayService;
