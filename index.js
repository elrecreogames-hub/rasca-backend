// ==============================
// 🎯 Backend Rasca y Gana — 1 juego por compra automático (v5)
// ==============================

import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: [
      "https://e28zpf-2k.myshopify.com", // 🔁 tu dominio Shopify
      "https://admin.shopify.com"
    ],
  })
);

// =====================================
// 🔐 CONFIGURACIÓN
// =====================================
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE; // ejemplo: e28zpf-2k.myshopify.com
const HEADERS = {
  "Content-Type": "application/json",
  "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
};

// =====================================
// 🔧 FUNCIONES BASE
// =====================================
async function obtenerClientePorEmail(email) {
  const res = await fetch(
    `https://${SHOPIFY_STORE}/admin/api/2023-10/customers/search.json?query=email:${email}`,
    { headers: HEADERS }
  );
  const data = await res.json();
  return data.customers?.[0] || null;
}

async function obtenerMetafield(customerId, namespace, key) {
  const res = await fetch(
    `https://${SHOPIFY_STORE}/admin/api/2023-10/customers/${customerId}/metafields.json`,
    { headers: HEADERS }
  );
  const data = await res.json();
  return data.metafields.find((m) => m.namespace === namespace && m.key === key);
}

async function updateMetafield(customerId, namespace, key, value, type = "json") {
  const existing = await obtenerMetafield(customerId, namespace, key);
  if (existing) {
    await fetch(
      `https://${SHOPIFY_STORE}/admin/api/2023-10/metafields/${existing.id}.json`,
      {
        method: "PUT",
        headers: HEADERS,
        body: JSON.stringify({
          metafield: { id: existing.id, value, type },
        }),
      }
    );
  } else {
    await fetch(`https://${SHOPIFY_STORE}/admin/api/2023-10/metafields.json`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        metafield: { namespace, key, value, type, owner_resource: "customer", owner_id: customerId },
      }),
    });
  }
}

// =====================================
// 🧩 WEBHOOK: Nueva compra → genera jugada
// =====================================
app.post("/webhook/order-created", async (req, res) => {
  try {
    const order = req.body;
    const email = order?.email;
    if (!email) return res.status(400).json({ ok: false, mensaje: "Orden sin email" });

    const customer = await obtenerClientePorEmail(email);
    if (!customer) return res.status(404).json({ ok: false, mensaje: "Cliente no encontrado" });

    // Guarda la orden como "pendiente de juego"
    await updateMetafield(customer.id, "custom", "ultima_orden_jugable", order.id.toString());

    // Mantén historial de jugadas
    const jugadas = await obtenerMetafield(customer.id, "custom", "compras_jugadas");
    const jugadasPrevias = jugadas?.value ? JSON.parse(jugadas.value) : [];
    await updateMetafield(customer.id, "custom", "compras_jugadas", JSON.stringify(jugadasPrevias), "json");

    console.log(`✅ Orden ${order.id} registrada para ${email}`);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ Error webhook:", err);
    res.status(500).json({ ok: false });
  }
});

// =====================================
// 🧩 Verifica si puede jugar con la orden
// =====================================
app.post("/check-juego", async (req, res) => {
  try {
    const { email, orderId } = req.body;
    const customer = await obtenerClientePorEmail(email);
    if (!customer) return res.json({ puedeJugar: false });

    const jugadas = await obtenerMetafield(customer.id, "custom", "compras_jugadas");
    const jugadasPrevias = jugadas?.value ? JSON.parse(jugadas.value) : [];

    const yaJugo = jugadasPrevias.some((j) => j.orderId === orderId);
    res.json({ puedeJugar: !yaJugo });
  } catch (err) {
    console.error("Error check-juego:", err);
    res.json({ puedeJugar: false });
  }
});

// =====================================
// 🧩 Registrar jugada (una vez por orden)
// =====================================
app.post("/registrar-juego", async (req, res) => {
  try {
    const { email, orderId, monedasGanadas } = req.body;
    const customer = await obtenerClientePorEmail(email);
    if (!customer) return res.json({ ok: false });

    // Recupera jugadas previas
    const jugadas = await obtenerMetafield(customer.id, "custom", "compras_jugadas");
    const jugadasPrevias = jugadas?.value ? JSON.parse(jugadas.value) : [];

    // Evita doble registro
    if (jugadasPrevias.some((j) => j.orderId === orderId)) {
      return res.json({ ok: false, mensaje: "Ya jugó con esta compra" });
    }

    // Agrega jugada nueva
    jugadasPrevias.push({ orderId, monedasGanadas, fecha: new Date().toISOString() });
    await updateMetafield(customer.id, "custom", "compras_jugadas", JSON.stringify(jugadasPrevias), "json");

    // Actualiza monedas totales
    const monedas = await obtenerMetafield(customer.id, "custom", "monedas_acumuladas");
    const saldo = monedas?.value ? parseInt(monedas.value) : 0;
    const nuevoTotal = saldo + (monedasGanadas || 0);
    await updateMetafield(customer.id, "custom", "monedas_acumuladas", nuevoTotal.toString(), "number_integer");

    console.log(`🎮 ${email} jugó orden ${orderId} y ganó ${monedasGanadas} monedas`);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error registrar-juego:", err);
    res.json({ ok: false });
  }
});

// =====================================
// 🧩 Nueva ruta: última orden jugable
// =====================================
app.post("/ultima-compra", async (req, res) => {
  try {
    const { email } = req.body;
    const cliente = await obtenerClientePorEmail(email);
    if (!cliente) return res.json({ ok: false, mensaje: "Cliente no encontrado" });

    const ordenJugable = await obtenerMetafield(cliente.id, "custom", "ultima_orden_jugable");
    const jugadas = await obtenerMetafield(cliente.id, "custom", "compras_jugadas");
    const jugadasPrevias = jugadas?.value ? JSON.parse(jugadas.value) : [];

    const yaJugo = jugadasPrevias.some(j => j.orderId === ordenJugable?.value);
    if (!ordenJugable?.value || yaJugo)
      return res.json({ ok: false, mensaje: "No hay compras disponibles para jugar." });

    res.json({ ok: true, orderId: ordenJugable.value });
  } catch (err) {
    console.error("Error ultima-compra:", err);
    res.status(500).json({ ok: false, mensaje: "Error interno" });
  }
});

// =====================================
// 🧩 Endpoint debug (monedas y jugadas)
// =====================================
app.get("/debug", async (req, res) => {
  const { email } = req.query;
  const customer = await obtenerClientePorEmail(email);
  if (!customer) return res.json({ ok: false, mensaje: "Cliente no encontrado" });

  const monedas = await obtenerMetafield(customer.id, "custom", "monedas_acumuladas");
  const jugadas = await obtenerMetafield(customer.id, "custom", "compras_jugadas");
  const ultima = await obtenerMetafield(customer.id, "custom", "ultima_orden_jugable");

  res.json({
    email,
    monedas: monedas?.value || 0,
    ultimaOrdenJugable: ultima?.value || null,
    jugadas: jugadas?.value ? JSON.parse(jugadas.value) : [],
  });
});

// =====================================
app.get("/", (req, res) => res.send("🎯 Backend Rasca y Gana v5 funcionando"));
app.listen(3000, () => console.log("🚀 Servidor en puerto 3000 listo"));
