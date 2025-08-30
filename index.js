const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 5000;

// Konfigurasi CORS
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Konfigurasi koneksi database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Tes koneksi saat start
pool.connect((err, client, release) => {
  if (err) {
    console.error('Gagal terhubung ke database:', err.stack);
    process.exit(1); // Hentikan server jika koneksi gagal
  }
  console.log('Koneksi database berhasil!');
  release();
});

// Middleware untuk logging request
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Endpoint produk
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products');
    res.json(result.rows);
  } catch (err) {
    console.error('Error di /api/products:', err.stack);
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
    console.error('Error di /api/products/:id:', err.stack);
    res.status(500).json({ error: 'Gagal mengambil detail produk' });
  }
});

// Endpoint cart - tambah item
app.post('/api/cart', async (req, res) => {
  const { user_id, product_id, quantity } = req.body;
  if (!product_id || !quantity) {
    return res.status(400).json({ error: 'product_id dan quantity diperlukan' });
  }
  try {
    const existingItem = await pool.query('SELECT * FROM cart WHERE product_id = $1', [product_id]);
    if (existingItem.rows.length > 0) {
      const updatedItem = await pool.query(
        'UPDATE cart SET quantity = quantity + $1 WHERE product_id = $2 RETURNING *',
        [quantity, product_id]
      );
      return res.status(200).json(updatedItem.rows[0]);
    } else {
      const result = await pool.query(
        'INSERT INTO cart (user_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING *',
        [user_id, product_id, quantity]
      );
      res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    console.error('Error menambahkan ke cart:', err.stack);
    res.status(500).json({ error: 'Gagal menambahkan ke keranjang' });
  }
});

// Endpoint cart - ambil semua item
app.get('/api/cart', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT c.*, p.name, p.price, p.image FROM cart c JOIN products p ON c.product_id = p.id'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error mengambil cart:', err.stack);
    res.status(500).json({ error: 'Gagal mengambil data keranjang' });
  }
});

// Endpoint cart - update quantity
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
    console.error('Error memperbarui cart:', err.stack);
    res.status(500).json({ error: 'Gagal memperbarui kuantitas' });
  }
});

// Endpoint cart - hapus item
app.delete('/api/cart/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM cart WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item tidak ditemukan' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('Error menghapus dari cart:', err.stack);
    res.status(500).json({ error: 'Gagal menghapus item dari keranjang' });
  }
});

// Middleware untuk error tak terduga
app.use((err, req, res, next) => {
  console.error('Error tak terduga:', err.stack);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

// Jalankan server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server berjalan di http://0.0.0.0:${PORT}`);
});