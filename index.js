const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'https://tokohonline.netlify.app', credentials: true }));
app.use(express.json());

// Logging untuk setiap request
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - Origin: ${req.get('origin')}`);
  next();
});

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

// Middleware autentikasi
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: Bearer <token>
  if (!token) {
    return res.status(401).json({ error: 'Token diperlukan' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
    req.user = decoded; // Simpan user_id dari token
    next();
  } catch (err) {
    console.error('Error verifikasi token:', err.message);
    res.status(403).json({ error: 'Token tidak valid' });
  }
};

// Endpoint registrasi
app.post('/api/register', async (req, res) => {
  const { full_name, email, password, address, city, postal_code } = req.body;
  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'full_name, email, dan password diperlukan' });
  }
  try {
    // Cek apakah email sudah ada
    const existingUser = await pool.query('SELECT * FROM "user" WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email sudah terdaftar' });
    }
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Insert user baru
    const result = await pool.query(
      'INSERT INTO "user" (full_name, email, password, address, city, postal_code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, full_name, email, address, city, postal_code',
      [full_name, email, hashedPassword, address || null, city || null, postal_code || null]
    );
    const user = result.rows[0];
    // Buat JWT
    const token = jwt.sign({ user_id: user.id }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '1h' });
    res.status(201).json({ user, token });
  } catch (err) {
    console.error('Error registrasi:', err.message);
    res.status(500).json({ error: 'Gagal mendaftar' });
  }
});

// Endpoint login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email dan password diperlukan' });
  }
  try {
    const result = await pool.query('SELECT * FROM "user" WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }
    const token = jwt.sign({ user_id: user.id }, process.env.JWT_SECRET || 'your_jwt_secret', { expiresIn: '1h' });
    res.json({ user: { id: user.id, full_name: user.full_name, email: user.email, address: user.address, city: user.city, postal_code: user.postal_code }, token });
  } catch (err) {
    console.error('Error login:', err.message);
    res.status(500).json({ error: 'Gagal login' });
  }
});

// Endpoint profil pengguna
app.get('/api/user', authenticateToken, async (req, res) => {
  const user_id = req.user.user_id;
  try {
    const result = await pool.query('SELECT id, full_name, email, address, city, postal_code FROM "user" WHERE id = $1', [user_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error mengambil profil:', err.message);
    res.status(500).json({ error: 'Gagal mengambil data pengguna' });
  }
});

// Endpoint root
app.get('/', (req, res) => {
  res.json({ message: '✅ Backend is running!' });
});

// Endpoint produk
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

// Endpoint cart (dilindungi autentikasi)
app.post('/api/cart', authenticateToken, async (req, res) => {
  const { product_id, quantity } = req.body;
  const user_id = req.user.user_id; // Ambil user_id dari JWT
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'product_id dan quantity harus valid' });
  }
  try {
    const existingItem = await pool.query(
      'SELECT * FROM cart WHERE product_id = $1 AND user_id = $2',
      [product_id, user_id]
    );
    if (existingItem.rows.length > 0) {
      const updatedItem = await pool.query(
        'UPDATE cart SET quantity = quantity + $1 WHERE product_id = $2 AND user_id = $3 RETURNING *',
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

app.get('/api/cart', authenticateToken, async (req, res) => {
  const user_id = req.user.user_id;
  try {
    const result = await pool.query(
      'SELECT c.*, p.name, p.price, p.image FROM cart c JOIN products p ON c.product_id = p.id WHERE c.user_id = $1',
      [user_id]
    );
    console.log(`Mengambil ${result.rows.length} item cart`);
    res.json(result.rows);
  } catch (err) {
    console.error('Error mengambil cart:', err.message);
    res.status(500).json({ error: 'Gagal mengambil data keranjang' });
  }
});

app.put('/api/cart/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;
  const user_id = req.user.user_id;
  if (!quantity || quantity <= 0) {
    return res.status(400).json({ error: 'quantity harus valid' });
  }
  try {
    const result = await pool.query(
      'UPDATE cart SET quantity = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [quantity, id, user_id]
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

app.delete('/api/cart/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.user_id;
  try {
    const result = await pool.query('DELETE FROM cart WHERE id = $1 AND user_id = $2 RETURNING *', [id, user_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item tidak ditemukan' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('Error menghapus dari cart:', err.message);
    res.status(500).json({ error: 'Gagal menghapus item dari keranjang' });
  }
});

// Error handler global
app.use((err, req, res, next) => {
  console.error('Error tak terduga:', err.message);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

module.exports = app;