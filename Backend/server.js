require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3221;

// Allow CORS from specific origins, including the artifact hosting domain for testing
const allowedOrigins = [
  'http://54.166.206.245:7771',
  'http://54.166.206.245:7772',
  'http://54.166.206.245:7773',
  'http://54.166.206.245:3221',
  'http://127.0.0.1:5500',
  `http://54.166.206.245:${port}`,
  'https://artifacts.grokusercontent.com' // Added temporarily for testing
];

app.use(cors({
  origin: (origin, callback) => {
    console.log(`CORS origin check - Origin: ${origin}`);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log(`CORS rejected - Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Get project root
const projectRoot = path.join(__dirname, '..');

// PostgreSQL setup
const pool = new Pool({
  user: process.env.PG_USER || 'postgres',
  host: process.env.PG_HOST || 'postgres',
  database: process.env.PG_DATABASE || 'new_employee_db',
  password: process.env.PG_PASSWORD || 'admin123',
  port: process.env.PG_PORT || 5432,
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.stack);
    process.exit(1);
  }
  console.log('✅ Connected to PostgreSQL database');
  release();
});

// Upload setup
const uploadDir = path.join(projectRoot, 'Backend', 'Uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log(`✅ Created upload directory at ${uploadDir}`);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  }
}).fields([
  { name: 'sscDoc', maxCount: 1 },
  { name: 'intermediateDoc', maxCount: 1 },
  { name: 'graduationDoc', maxCount: 1 },
  { name: 'additional_files', maxCount: 1 },
  { name: 'offerLetter', maxCount: 1 }
]);

const offerLetterUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  }
}).single('offerLetter');

// Static file serving
app.use(express.static(path.join(projectRoot, 'Frontend')));
app.use('/hr', express.static(path.join(projectRoot, 'HR_Page')));
app.use('/offer-letter', express.static(path.join(projectRoot, 'Offer_Letter')));
app.use('/Uploads', express.static(uploadDir));

// Initialize DB
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS job_applications (
        id SERIAL PRIMARY KEY,
        reference_id VARCHAR(15) UNIQUE NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        mobile_number VARCHAR(10) UNIQUE NOT NULL,
        department VARCHAR(50) NOT NULL,
        job_role VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ssc_doc_path VARCHAR(255),
        intermediate_doc_path VARCHAR(255),
        graduation_doc_path VARCHAR(255),
        offer_letter_path VARCHAR(255),
        dob DATE,
        father_name VARCHAR(100),
        permanent_address VARCHAR(255),
        expected_salary INTEGER,
        interview_date DATE,
        joining_date VARCHAR(50),
        employment_type VARCHAR(50),
        branch_location VARCHAR(50),
        ssc_year INTEGER,
        ssc_percentage VARCHAR(10),
        intermediate_year INTEGER,
        intermediate_percentage VARCHAR(10),
        college_name VARCHAR(100),
        register_number VARCHAR(20),
        graduation_year INTEGER,
        graduation_percentage VARCHAR(10),
        additional_certifications TEXT,
        additional_files_path VARCHAR(255),
        experience_status VARCHAR(20),
        years_of_experience INTEGER,
        previous_company VARCHAR(100),
        previous_job_role VARCHAR(50)
      );
    `);
    console.log('✅ Database tables verified/created successfully');
  } catch (err) {
    console.error('❌ Database initialization failed:', err.stack);
    throw err;
  }
}

// Routes

// Test route for debugging
app.post('/api/test', (req, res) => {
  console.log('Test request received:', req.body);
  res.status(200).json({ success: true, message: 'Test request successful' });
});

// Submit application
app.post('/api/applications', upload, async (req, res) => {
  console.log('Request received at /api/applications');
  console.log('Form data:', req.body);
  console.log('Files:', req.files);
  try {
    const formData = req.body;
    const files = req.files;

    const requiredFields = [
      'full_name', 'email', 'mobile_number', 'department', 'job_role',
      'dob', 'father_name', 'permanent_address', 'expected_salary',
      'employment_type', 'branch_location', 'ssc_year', 'ssc_percentage',
      'intermediate_year', 'intermediate_percentage', 'college_name',
      'register_number', 'graduation_year', 'graduation_percentage',
      'experience_status'
    ];

    for (const field of requiredFields) {
      if (!formData[field]) {
        console.log(`Missing field: ${field}`);
        return res.status(400).json({ success: false, message: `Missing field: ${field}` });
      }
    }

    if (!files.sscDoc || !files.intermediateDoc || !files.graduationDoc) {
      console.log('Missing required documents');
      return res.status(400).json({ success: false, message: 'Missing required documents' });
    }

    const referenceId = generateReferenceId();
    console.log(`Generated referenceId: ${referenceId}`);

    const values = [
      referenceId,
      formData.full_name,
      formData.email,
      formData.mobile_number,
      formData.department,
      formData.job_role,
      files.sscDoc?.[0]?.filename || null,
      files.intermediateDoc?.[0]?.filename || null,
      files.graduationDoc?.[0]?.filename || null,
      formData.dob || null,
      formData.father_name || null,
      formData.permanent_address || null,
      parseInt(formData.expected_salary) || null,
      formData.interview_date || null,
      formData.joining_date || null,
      formData.employment_type || null,
      formData.branch_location || null,
      parseInt(formData.ssc_year) || null,
      formData.ssc_percentage || null,
      parseInt(formData.intermediate_year) || null,
      formData.intermediate_percentage || null,
      formData.college_name || null,
      formData.register_number || null,
      parseInt(formData.graduation_year) || null,
      formData.graduation_percentage || null,
      formData.additional_certifications || null,
      files.additional_files?.[0]?.filename || null,
      formData.experience_status || null,
      parseInt(formData.years_of_experience) || null,
      formData.previous_company || null,
      formData.previous_job_role || null
    ];

    const insertQuery = `
      INSERT INTO job_applications (
        reference_id, full_name, email, mobile_number,
        department, job_role, ssc_doc_path,
        intermediate_doc_path, graduation_doc_path,
        dob, father_name, permanent_address,
        expected_salary, interview_date, joining_date,
        employment_type, branch_location,
        ssc_year, ssc_percentage,
        intermediate_year, intermediate_percentage,
        college_name, register_number,
        graduation_year, graduation_percentage,
        additional_certifications, additional_files_path,
        experience_status, years_of_experience,
        previous_company, previous_job_role
      )
      VALUES (${Array.from({ length: 31 }, (_, i) => `$${i + 1}`).join(', ')})
      RETURNING id, reference_id;
    `;

    const result = await pool.query(insertQuery, values);
    console.log(`Saved referenceId in database: ${result.rows[0].reference_id}`);
    console.log('Database insertion successful:', result.rows[0]);

    res.status(201).json({ success: true, referenceId: result.rows[0].reference_id });
  } catch (err) {
    console.error('❌ Error submitting application:', err.stack);
    res.status(500).json({
      success: false,
      message:
        err.constraint === 'job_applications_email_key' ? 'Email already exists' :
        err.constraint === 'job_applications_mobile_number_key' ? 'Mobile number already exists' :
        err.message.includes('Only PDF') ? err.message :
        'Failed to submit application'
    });
  }
});

// Get all applications
app.get('/api/applications', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, reference_id, full_name, email, 
             mobile_number, department, job_role, status, created_at, offer_letter_path
      FROM job_applications
      ORDER BY created_at DESC;
    `);
    console.log('Fetched applications for HR:', result.rows);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('❌ Error fetching applications:', err.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch applications' });
  }
});

// Get application by ID
app.get('/api/applications/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid application ID' });
    }

    const result = await pool.query(`SELECT * FROM job_applications WHERE id = $1`, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }
    console.log(`Fetched application ID ${id} for HR details view:`, result.rows[0]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('❌ Error fetching application:', err.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch application' });
  }
});

// Update application status
app.put('/api/applications/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = req.body;

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid application ID' });
    }

    if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const result = await pool.query(`
      UPDATE job_applications SET status = $1 WHERE id = $2 RETURNING id, status;
    `, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    console.log(`Updated status for application ID ${id} to ${status}`);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('❌ Error updating status:', err.stack);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

// Upload offer letter
app.post('/api/applications/:id/offer-letter', offerLetterUpload, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const file = req.file;

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid application ID' });
    }

    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    // Check if the application exists and is approved
    const checkApplication = await pool.query(`
      SELECT status, offer_letter_path 
      FROM job_applications 
      WHERE id = $1;
    `, [id]);

    if (checkApplication.rows.length === 0) {
      fs.unlinkSync(path.join(uploadDir, file.filename));
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    if (checkApplication.rows[0].status !== 'Approved') {
      fs.unlinkSync(path.join(uploadDir, file.filename));
      return res.status(400).json({ success: false, message: 'Application must be approved to upload an offer letter' });
    }

    // If an existing offer letter exists, delete it
    if (checkApplication.rows[0].offer_letter_path) {
      const oldFilePath = path.join(uploadDir, checkApplication.rows[0].offer_letter_path);
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
        console.log(`Deleted previous offer letter: ${checkApplication.rows[0].offer_letter_path}`);
      }
    }

    const result = await pool.query(`
      UPDATE job_applications 
      SET offer_letter_path = $1 
      WHERE id = $2
      RETURNING id, offer_letter_path;
    `, [file.filename, id]);

    console.log(`Uploaded offer letter for application ID ${id}: ${file.filename}`);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('❌ Error uploading offer letter:', err.stack);
    if (req.file) {
      fs.unlinkSync(path.join(uploadDir, req.file.filename));
    }
    res.status(500).json({ 
      success: false, 
      message: err.message.includes('Only PDF') ? err.message : 'Failed to upload offer letter' 
    });
  }
});

// Download offer letter
app.get('/api/offer-letter', async (req, res) => {
  try {
    const { reference_id, email } = req.query;

    if (!reference_id || !email) {
      return res.status(400).json({ success: false, message: 'Reference ID and email are required' });
    }

    const result = await pool.query(`
      SELECT offer_letter_path 
      FROM job_applications 
      WHERE reference_id = $1 AND email = $2 AND status = 'Approved';
    `, [reference_id, email]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Application not found or not approved' });
    }

    if (!result.rows[0].offer_letter_path) {
      return res.status(404).json({ success: false, message: 'Offer letter not found' });
    }

    const filePath = path.join(uploadDir, result.rows[0].offer_letter_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Offer letter file not found on server' });
    }

    console.log(`Fetched offer letter for reference_id ${reference_id}: ${result.rows[0].offer_letter_path}`);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('❌ Error fetching offer letter:', err.stack);
    res.status(500).json({ success: false, message: 'Failed to fetch offer letter' });
  }
});

// Document download
app.get('/api/documents/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    console.log(`Downloading document: ${req.params.filename}`);
    res.download(filePath);
  } else {
    console.log(`Document not found: ${req.params.filename}`);
    res.status(404).json({ success: false, message: 'File not found' });
  }
});

// Root routes
app.get('/', (req, res) => {
  console.log('Serving employee form at /');
  res.sendFile(path.join(projectRoot, 'Frontend', 'index.html'));
});

app.get('/hr', (req, res) => {
  console.log('Serving HR dashboard at /hr');
  res.sendFile(path.join(projectRoot, 'HR_Page', 'index.html'));
});

app.get('/offer-letter', (req, res) => {
  console.log('Serving offer letter page at /offer-letter');
  res.sendFile(path.join(projectRoot, 'Offer_Letter', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
});

// Generate unique reference ID
function generateReferenceId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 15 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Start server
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`✅ Server running at: http://54.166.206.245:${port}`);
    console.log(`📄 Job application form: http://54.166.206.245:${port}`);
    console.log(`👥 HR dashboard: http://54.166.206.245:${port}/hr`);
    console.log(`📜 Offer letter download: http://54.166.206.245:${port}/offer-letter`);
    console.log(`🩺 Health check: http://54.166.206.245:${port}/health`);
  });
}).catch(err => {
  console.error('❌ Failed to start server:', err.stack);
  process.exit(1);
});