const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.FRONTEND_URL || '*', optionsSuccessStatus: 200, credentials: true }));
app.use(express.json());

console.log('Environment variables:');
console.log('  DATABASE_URL:', process.env.DATABASE_URL || 'Tidak diatur');
console.log('  FRONTEND_URL:', process.env.FRONTEND_URL || 'Tidak diatur');
console.log('  NODE_ENV:', process.env.NODE_ENV || 'Tidak diatur');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    const client = await pool.connect();
    console.log('✅ Koneksi database berhasil!');
    const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log('Tabel di database:', tables.rows.map(row => row.table_name));
    client.release();
  } catch (err) {
    console.error('❌ Gagal terhubung ke database:', err.message);
  }
})();

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - Origin: ${req.get('origin')}`);
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'Server berjalan',
    database_url: process.env.DATABASE_URL || 'Tidak diatur',
    frontend_url: process.env.FRONTEND_URL || 'Tidak diatur',
    node_env: process.env.NODE_ENV || 'Tidak diatur',
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.json({ message: '✅ Backend is running!' });
});

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
    console.log(`Mengambil ${result.rows.length} produk`);
    res.json(result.rows);
  } catch (err) {
    console.error('Error di /api/products:', err.message);
    res.status(500).json({ error: 'Gagal mengambil data produk' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produk tidak ditemukan' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error di /api/products/:id:', err.message);
    res.status(500).json({ error: 'Gagal mengambil detail produk' });
  }
});

app.post('/api/cart', async (req, res) => {
  const { user_id, product_id, quantity } = req.body;
  if (!product_id || !quantity) {
    return res.status(400).json({ error: 'product_id dan quantity diperlukan' });
  }
  try {
    const existingItem = await pool.query(
      'SELECT * FROM cart WHERE product_id = $1 AND user_id IS NOT DISTINCT FROM $2',
      [product_id, user_id]
    );
    if (existingItem.rows.length > 0) {
      const updatedItem = await pool.query(
        'UPDATE cart SET quantity = quantity + $1 WHERE product_id = $2 AND user_id IS NOT DISTINCT FROM $3 RETURNING *',
        [quantity, product_id, user_id]
      );
      return res.status(200).json(updatedItem.rows[0]);
    } else {
      const result = await pool.query(
        'INSERT INTO cart (user_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING *',
        [user_id, product_id, quantity]
      );
      return res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    console.error('Error menambahkan ke cart:', err.message);
    res.status(500).json({ error: 'Gagal menambahkan ke keranjang' });
  }
});

app.get('/api/cart', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT c.*, p.name, p.price, p.image FROM cart c JOIN products p ON c.product_id = p.id'
    );
    console.log(`Mengambil ${result.rows.length} item cart`);
    res.json(result.rows);
  } catch (err) {
    console.error('Error mengambil cart:', err.message);
    res.status(500).json({ error: 'Gagal mengambil data keranjang' });
  }
});

app.put('/api/cart/:id', async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;
  if (!quantity) {
    return res.status(400).json({ error: 'quantity diperlukan' });
  }
  try {
    const result = await pool.query(
      'UPDATE cart SET quantity = $1 WHERE id = $2 RETURNING *',
      [quantity, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item tidak ditemukan' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error memperbarui cart:', err.message);
    res.status(500).json({ error: 'Gagal memperbarui kuantitas' });
  }
});

app.delete('/api/cart/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM cart WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item tidak ditemukan' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('Error menghapus dari cart:', err.message);
    res.status(500).json({ error: 'Gagal menghapus item dari keranjang' });
  }
});

app.use((err, req, res, next) => {
  console.error('Error tak terduga:', err.message);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server berjalan di http://0.0.0.0:${PORT}`);
  console.log('Environment variables (server start):');
  console.log('  DATABASE_URL:', process.env.DATABASE_URL || 'Tidak diatur');
  console.log('  FRONTEND_URL:', process.env.FRONTEND_URL || 'Tidak diatur');
  console.log('  NODE_ENV:', process.env.NODE_ENV || 'Tidak diatur');
});