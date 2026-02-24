const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const bspayService = {
  gerarPix: async (dados) => {
    try {
      const url = 'https://api.bspay.co'; // Verifique se precisa de /v1/pix etc
      
      // O Fixie fornece uma URL no formato: http://user:pass@host:port
      // Ela deve estar configurada nas variáveis de ambiente do Render como FIXIE_URL
      const proxyUrl = process.env.FIXIE_URL;
      const agent = new HttpsProxyAgent(proxyUrl);

      const config = {
        httpsAgent: agent, // O Agent faz o túnel pelo IP estático
        proxy: false,      // Importante desativar o proxy nativo do Axios para usar o Agent
        headers: {
          'Authorization': `Bearer ${process.env.BSPAY_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };

      const body = {
        name: dados.nome,
        taxId: dados.cpf.replace(/\D/g, '') || "00000000000", 
        value: parseFloat(dados.valor),
        postbackUrl: `https://tacadaonline-beckend.onrender.com`
      };

      console.log(`[BSPAY] Enviando requisição via Proxy Fixie para IP Estático...`);

      const response = await axios.post(url, body, config);
      return response.data;

    } catch (error) {
      const erroStatus = error.response?.status;
      const erroData = error.response?.data;

      console.error(`[BSPAY ERROR] Status: ${erroStatus}`);
      if (erroStatus === 403) {
        console.error("DICA: Verifique se o IP do Fixie foi liberado no painel da BSPAY.");
      }
      
      throw new Error(erroData?.message || "Falha na comunicação com a API de pagamento.");
    }
  }
};

module.exports = bspayService;
