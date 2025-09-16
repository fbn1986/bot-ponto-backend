// --- Dependências ---
const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');

// --- Configuração do Firebase ---
const serviceAccount = require(`./${process.env.FIREBASE_SERVICE_ACCOUNT_FILE}`);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
console.log('Firebase Admin SDK inicializado com sucesso.');

// --- Configuração do Servidor Express ---
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- Rota Principal ---
app.get('/', (req, res) => {
  res.send('Servidor do Bot de Ponto está rodando! Configure o webhook para a rota /webhook.');
});

// --- ROTA DO WEBHOOK (Onde a Evolution API vai enviar as mensagens) ---
app.post('/webhook', async (req, res) => {
  console.log('Webhook recebido!');

  try {
    if (req.body.event !== 'messages.upsert') {
      return res.sendStatus(200);
    }

    const messageData = req.body.data;
    const messageBody = messageData.message?.conversation;
    const sender = messageData.key?.remoteJid;

    if (!messageBody || !sender || messageData.key?.fromMe) {
      return res.sendStatus(200);
    }

    const senderId = sender.split('@')[0];
    const commandParts = messageBody.toLowerCase().trim().split(' ');
    const mainCommand = commandParts[0];
    let replyText;

    if (mainCommand === 'entrada' || mainCommand === 'saída') {
      await addRecord(senderId, mainCommand);
      replyText = `✅ Ponto de *${mainCommand}* registrado com sucesso às ${new Date().toLocaleTimeString('pt-BR')}!`;
    } else if (mainCommand === 'relatório') {
      const params = commandParts.slice(1).join(' '); 
      replyText = await handleReportRequest(senderId, params);
    } else if (messageBody.toLowerCase().trim() === 'gerardadosficticios') {
      // NOVO COMANDO SECRETO PARA GERAR DADOS
      replyText = await generateMockData(senderId);
    }
    else {
      replyText = 'Comando inválido. Exemplos:\n- Entrada\n- Saída\n- Relatório\n- Relatório últimos 7 dias\n- Relatório 01/09/2025 até 15/09/2025';
    }

    await sendReply(sender, replyText);

  } catch (error) {
    console.error('Erro ao processar o webhook:', error.message);
  }

  res.sendStatus(200);
});


// --- Funções Auxiliares ---

// NOVA FUNÇÃO: Gera dados de teste para os últimos 5 dias úteis
async function generateMockData(userId) {
    console.log(`Iniciando geração de dados fictícios para ${userId}`);
    const collectionPath = `artifacts/${appId}/users/${userId}/registros_ponto`;
    const batch = db.batch();

    // 1. Limpa registros antigos do usuário
    const snapshot = await db.collection(collectionPath).get();
    if (!snapshot.empty) {
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`Registros antigos de ${userId} foram limpos.`);
    }

    // 2. Gera novos registros para os últimos 5 dias
    const newBatch = db.batch();
    for (let i = 1; i <= 5; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);

        // Pula Sábados (6) e Domingos (0)
        if (date.getDay() === 0 || date.getDay() === 6) continue;

        // Horários com pequena variação aleatória
        const entrada1 = new Date(date);
        entrada1.setHours(9, Math.floor(Math.random() * 10), 0, 0); // 09:00 - 09:09

        const saida1 = new Date(date);
        saida1.setHours(12, 30 + Math.floor(Math.random() * 10), 0, 0); // 12:30 - 12:39

        const entrada2 = new Date(date);
        entrada2.setHours(13, 30 + Math.floor(Math.random() * 10), 0, 0); // 13:30 - 13:39

        const saida2 = new Date(date);
        saida2.setHours(18, Math.floor(Math.random() * 10), 0, 0); // 18:00 - 18:09

        const records = [
            { type: 'entrada', timestamp: entrada1 },
            { type: 'saída', timestamp: saida1 },
            { type: 'entrada', timestamp: entrada2 },
            { type: 'saída', timestamp: saida2 }
        ];

        records.forEach(record => {
            const docRef = db.collection(collectionPath).doc(); // Cria uma nova referência de documento
            newBatch.set(docRef, record);
        });
    }

    await newBatch.commit();
    console.log(`Dados fictícios gerados para ${userId}`);
    return '🚀 Dados de teste para os últimos dias úteis foram gerados!\n\nExperimente agora:\n*- Relatório últimos 7 dias*';
}


async function addRecord(userId, type) {
  const record = {
    type: type,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  };
  const collectionPath = `artifacts/${appId}/users/${userId}/registros_ponto`;
  await db.collection(collectionPath).add(record);
  console.log(`Registro de '${type}' salvo para o usuário ${userId}`);
}

function parseDate(dateString) {
    const parts = dateString.trim().split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    const date = new Date(year, month, day);
    date.setHours(0, 0, 0, 0);
    return date;
}

async function handleReportRequest(userId, params) {
    let startDate, endDate, reportTitle;

    // Comando: relatório [data1] até [data2]
    if (params.includes('até')) {
        const dates = params.split('até');
        startDate = parseDate(dates[0]);
        endDate = parseDate(dates[1]);
        if (!startDate || !endDate) return 'Formato de data inválido. Use: relatório DD/MM/AAAA até DD/MM/AAAA';
        endDate.setDate(endDate.getDate() + 1); 
        reportTitle = `de ${startDate.toLocaleDateString('pt-BR')} até ${endDate.toLocaleDateString('pt-BR')}`;

    // Comando: relatório últimos X dias
    } else if (params.startsWith('últimos')) {
        const days = parseInt(params.split(' ')[1], 10);
        if (isNaN(days)) return 'Comando inválido. Use: relatório últimos 7 dias';
        endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
        startDate = new Date();
        startDate.setDate(startDate.getDate() - days + 1);
        startDate.setHours(0, 0, 0, 0);
        reportTitle = `dos Últimos ${days} Dias`;

    // Comando: relatório ontem
    } else if (params === 'ontem') {
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);
        reportTitle = 'de Ontem';

    // Comando: relatório (hoje)
    } else {
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);
        reportTitle = 'de Hoje';
    }

    return generateReport(userId, startDate, endDate, reportTitle);
}


async function generateReport(userId, startDate, endDate, reportTitle) {
  const collectionPath = `artifacts/${appId}/users/${userId}/registros_ponto`;

  const snapshot = await db.collection(collectionPath)
    .where('timestamp', '>=', startDate)
    .where('timestamp', '<', endDate)
    .get();

  if (snapshot.empty) {
    return `Você não tem nenhum registro de ponto para o período: ${reportTitle}.`;
  }

  const records = snapshot.docs.map(doc => doc.data()).sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());

  // Agrupa os registros por dia
  const dailyRecords = {};
  records.forEach(record => {
      const day = record.timestamp.toDate().toLocaleDateString('pt-BR');
      if (!dailyRecords[day]) dailyRecords[day] = [];
      dailyRecords[day].push(record);
  });

  let grandTotalMillis = 0;
  let reportText = `📊 *Relatório ${reportTitle}*\n\n`;

  // Itera sobre cada dia para calcular as horas
  for (const day in dailyRecords) {
      const dayRecords = dailyRecords[day];
      let dailyTotalMillis = 0;
      let lastEntrada = null;

      dayRecords.forEach(record => {
          if (record.type === 'entrada') {
              lastEntrada = record.timestamp;
          } else if (record.type === 'saída' && lastEntrada) {
              dailyTotalMillis += record.timestamp.toMillis() - lastEntrada.toMillis();
              lastEntrada = null;
          }
      });

      if (dailyTotalMillis > 0) {
          const hours = Math.floor(dailyTotalMillis / 3600000);
          const minutes = Math.floor((dailyTotalMillis % 3600000) / 60000);
          reportText += `*- ${day}:* ${hours}h e ${minutes}min\n`;
          grandTotalMillis += dailyTotalMillis;
      }
  }

  if (grandTotalMillis > 0) {
    reportText += '\n';
    const totalHours = Math.floor(grandTotalMillis / 3600000);
    const totalMinutes = Math.floor((grandTotalMillis % 3600000) / 60000);
    reportText += `*Total no período:* ${totalHours}h e ${totalMinutes}min`;
  } else {
      reportText += '*Nenhuma hora trabalhada registrada no período.*';
  }

  return reportText;
}


async function sendReply(to, text) {
  const apiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME;

  if (!apiUrl || !apiKey || !instanceName) {
    return;
  }

  const sendMessageUrl = `${apiUrl}/message/sendText/${instanceName}`;
  const recipientNumber = to.split('@')[0];

  try {
    await axios.post(sendMessageUrl, {
      number: recipientNumber,
      options: { delay: 1200, presence: "composing" },
      text: text
    }, {
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json' }
    });
    console.log(`Resposta enviada para ${to}`);
  } catch (error) {
    if (error.response) {
      console.error('Erro detalhado da Evolution API:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Erro ao enviar resposta via Evolution API:', error.message);
    }
  }
}

// --- Inicia o Servidor ---
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});