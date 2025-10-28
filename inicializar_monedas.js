import fetch from "node-fetch";

const SHOP = "TU-TIENDA.myshopify.com"; // reemplaza con tu tienda
const ACCESS_TOKEN = "TU_ACCESS_TOKEN_ADMIN"; // reemplaza con tu token
const BASE_URL = `https://${SHOP}/admin/api/2025-10/graphql.json`;

// Obtener todos los clientes
async function fetchAllCustomers() {
  let customers = [];
  let hasNextPage = true;
  let endCursor = null;

  while (hasNextPage) {
    const query = `
      {
        customers(first: 100 ${endCursor ? `, after: "${endCursor}"` : ""}) {
          edges {
            node {
              id
              email
              metafields(first: 10, namespace: "custom") {
                edges {
                  node { key }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ACCESS_TOKEN
      },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    const edges = data.data.customers.edges;
    customers.push(...edges.map(e => e.node));
    hasNextPage = data.data.customers.pageInfo.hasNextPage;
    endCursor = data.data.customers.pageInfo.endCursor;
  }

  return customers;
}

// Crear el metafield de monedas si no existe
async function createMetafield(customerId) {
  const mutation = `
    mutation {
      metafieldsSet(input: {
        ownerId: "${customerId}",
        metafields: [
          {
            namespace: "custom",
            key: "monedas_acumuladas",
            type: "number_integer",
            value: "0"
          }
        ]
      }) {
        metafields { id }
        userErrors { field message }
      }
    }
  `;
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ACCESS_TOKEN
    },
    body: JSON.stringify({ query: mutation })
  });
  const data = await res.json();
  return data;
}

async function main() {
  const customers = await fetchAllCustomers();
  console.log(`Clientes encontrados: ${customers.length}`);

  for (const customer of customers) {
    const hasMetafield = customer.metafields.edges.some(e => e.node.key === "monedas_acumuladas");
    if (!hasMetafield) {
      console.log(`Creando metafield para: ${customer.email}`);
      const result = await createMetafield(customer.id);
      if (result.data.metafieldsSet.userErrors.length > 0) {
        console.error(result.data.metafieldsSet.userErrors);
      }
    } else {
      console.log(`Ya tiene metafield: ${customer.email}`);
    }
  }

  console.log("✅ Todos los clientes procesados");
}

main().catch(console.error);
