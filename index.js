const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const cors = require("cors");
const app = express();
const PORT = 3000;
const baseUrl = "https://jsearch.p.rapidapi.com/search-v2";
const API_TIMEOUT_MS = 12_000;

const nodemailer = require("nodemailer");
const nodCron = require("node-cron");

const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 587,
  secure: false, // use STARTTLS (upgrade connection to TLS after connecting)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

app.use(express.json());
app.use(
  cors({
    origin: false,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    routes: {
      jobs: "GET /api/jobs",
    },
  });
});

const SEARCH_QUERIES = [
  "Desenvolvedor Junior",
  "Desenvolvedor Backend Junior",
  "Desenvolvedor Node.js",
  "Desenvolvedor Frontend Junior",
  "Desenvolvedor Full Stack Junior",
];

async function fetchJobsByQuery(query, datePosted = "3days") {
  const params = new URLSearchParams({
    query,
    country: "br",
    language: "pt",
    num_pages: "1",
    date_posted: datePosted,
  });

  const response = await fetch(`${baseUrl}?${params}`, {
    headers: {
      "x-rapidapi-key": process.env.RAPIDAPI_KEY,
      "x-rapidapi-host": "jsearch.p.rapidapi.com",
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.message || "A API de vagas retornou um erro.");
    error.status = response.status;
    throw error;
  }

  return Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.data?.jobs)
      ? data.data.jobs
      : Array.isArray(data.jobs)
        ? data.jobs
        : [];
}

async function fetchJobs(datePosted = "3days") {
  if (!process.env.RAPIDAPI_KEY) {
    throw new Error("A variável RAPIDAPI_KEY não está configurada.");
  }

  const uniqueJobs = new Map();

  const results = await Promise.all(
    SEARCH_QUERIES.map(async (query) => {
      try {
        return await fetchJobsByQuery(query, datePosted);
      } catch (error) {
        console.error(`Erro ao buscar vagas para "${query}":`, error.message);
        return [];
      }
    }),
  );

  for (const jobs of results) {
    for (const job of jobs) {
      const jobKey =
        job.job_id ||
        job.job_apply_link ||
        job.apply_link ||
        `${job.job_title || job.title}-${job.employer_name || ""}`;

      if (!uniqueJobs.has(jobKey)) {
        uniqueJobs.set(jobKey, job);
      }
    }
  }

  return Array.from(uniqueJobs.values()).sort(
    (a, b) =>
      (b.job_posted_at_timestamp || 0) - (a.job_posted_at_timestamp || 0),
  );
}

app.get("/api/jobs", async (req, res) => {
  try {
    const datePosted = req.query.date_posted || "3days";
    const jobs = await fetchJobs(datePosted);
    res.json(jobs);
  } catch (error) {
    console.error("Erro ao buscar vagas:", error.message);
    res
      .status(error.status || 500)
      .json({ error: error.message || "Erro ao buscar vagas." });
  }
});

async function sendJobsEmail(datePosted = "3days") {
  await transporter.verify();
  console.log("Server is ready to take our messages");

  const jobs = await fetchJobs(datePosted);

  const info = await transporter.sendMail({
    from: '"Thiago Dev" <thiago@thiagodevsite.com>',
    to: "thiagokilu34@gmail.com",
    subject: "Novas vagas de emprego",
    text: "Confira as novas vagas encontradas pela minha API!",
    html: `
    <h2>Minha API de Vagas 🚀</h2>

    <p>Confira as vagas encontradas:</p>

    ${jobs
      .map(
        (job) => `
          <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px;">
            <h3>${job.job_title || job.title}</h3>
            <p><strong>Empresa:</strong> ${job.employer_name || "N/A"}</p>
            <p><strong>Localização:</strong> ${job.job_city || job.job_location || "N/A"}</p>
            <p><strong>Data de publicação:</strong> ${new Date(job.job_posted_at_timestamp * 1000).toLocaleDateString()}</p>
            <a
              href="${job.job_apply_link || job.apply_link}"
              target="_blank"
              style="display: inline-block; padding: 10px 16px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px;"
            >
              Ver vaga
            </a>
          </div>
        `,
      )
      .join("")}
  `,
  });

  console.log("Message sent: %s", info.messageId);
  // Preview URL is only available when using an Ethereal test account
  console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));

  return info;
}

app.post("/api/send-email", async (req, res) => {
  try {
    const datePosted =
      req.query.date_posted || req.body?.date_posted || "3days";
    await sendJobsEmail(datePosted);
    console.log("Email sent successfully at", new Date().toLocaleTimeString());
    return res.json({ message: "Email sent successfully" });
  } catch (err) {
    console.error("Error while sending mail:", err);
    return res
      .status(err.status || 500)
      .json({ error: err.message || "Erro ao enviar e-mail." });
  }
});

nodCron.schedule("0 3,8,12,18 * * *", async () => {
  try {
    await sendJobsEmail();
    console.log("E-mail agendado enviado às", new Date().toLocaleTimeString());
  } catch (err) {
    console.error("Erro ao enviar e-mail agendado:", err);
  }
});

nodCron.schedule("* * * * *", () => {
  console.log("Cron disparou:", new Date().toLocaleTimeString());
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
