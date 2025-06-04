require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Initialize Express app
const app = express();
const port = process.env.PORT || 3221;

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.chmodSync(uploadsDir, 0o777);
}

// Security middleware
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Logging
app.use(morgan('dev'));

// CORS configuration
const allowedOrigins = [
  'http://54.166.206.245:7771',
  'http://54.166.206.245:7772',
  'http://54.166.206.245:7773',
  'http://54.166.206.245:3221',
  'http://localhost:7771',
  'http://localhost:7772',
  'http://localhost:7773',
  'http://127.0.0.1:5500'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Database configuration
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.PG_HOST || 'postgres',
  database: process.env.DB_NAME || 'new_employee_db',
  password: process.env.DB_PASSWORD || 'admin123',
  port: process.env.DB_PORT || 5432,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.query('SELECT NOW()', (err) => {
  if (err) {
    console.error('Database connection error:', err.stack);
  } else {
    console.log('Database connected successfully');
  }
});

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter
});

// Routes
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Submit job application
app.post('/api/applications', 
  upload.fields([
    { name: 'sscDoc', maxCount: 1 },
    { name: 'intermediateDoc', maxCount: 1 },
    { name: 'graduationDoc', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const requiredFields = [
        'full_name', 'email', 'mobile_number', 
        'department', 'job_role'
      ];
      
      const missingFields = requiredFields.filter(field => !req.body[field]);
      if (missingFields.length > 0) {
        return res.status(400).json({ 
          error: 'Missing required fields',
          missing: missingFields 
        });
      }

      const reference_id = `REF${Date.now()}${Math.floor(Math.random() * 1000)}`;

      const query = `
        INSERT INTO job_applications (
          reference_id, full_name, email, mobile_number, department, job_role,
          dob, father_name, permanent_address, expected_salary, interview_date,
          joining_date, employment_type, branch_location, ssc_year, ssc_percentage,
          intermediate_year, intermediate_percentage, college_name, register_number,
          graduation_year, graduation_percentage, experience_status, ssc_doc,
          intermediate_doc, graduation_doc, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, 'Pending')
        RETURNING id, reference_id
      `;

      const values = [
        reference_id,
        req.body.full_name,
        req.body.email,
        req.body.mobile_number,
        req.body.department,
        req.body.job_role,
        req.body.dob || null,
        req.body.father_name || null,
        req.body.permanent_address || null,
        req.body.expected_salary || null,
        req.body.interview_date || null,
        req.body.joining_date || null,
        req.body.employment_type || null,
        req.body.branch_location || null,
        req.body.ssc_year || null,
        req.body.ssc_percentage || null,
        req.body.intermediate_year || null,
        req.body.intermediate_percentage || null,
        req.body.college_name || null,
        req.body.register_number || null,
        req.body.graduation_year || null,
        req.body.graduation_percentage || null,
        req.body.experience_status || 'No',
        req.files['sscDoc'] ? req.files['sscDoc'][0].path : null,
        req.files['intermediateDoc'] ? req.files['intermediateDoc'][0].path : null,
        req.files['graduationDoc'] ? req.files['graduationDoc'][0].path : null
      ];

      const result = await pool.query(query, values);
      
      res.status(201).json({
        success: true,
        message: 'Application submitted successfully',
        reference_id: result.rows[0].reference_id
      });

    } catch (error) {
      console.error('Application submission error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Get all applications
app.get('/api/applications', async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM job_applications ORDER BY created_at DESC';
    let params = [];

    if (status) {
      query = 'SELECT * FROM job_applications WHERE status = $1 ORDER BY created_at DESC';
      params = [status];
    }

    const result = await pool.query(query, params);
    res.status(200).json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch applications'
    });
  }
});

// Update application status
app.patch('/api/applications/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid status value' 
      });
    }

    const result = await pool.query(
      'UPDATE job_applications SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Application not found' 
      });
    }

    res.status(200).json({
      success: true,
      message: 'Status updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update status' 
    });
  }
});

// Upload offer letter
app.post('/api/applications/:id/offer-letter', 
  upload.single('offerLetter'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ 
          success: false,
          error: 'No file uploaded' 
        });
      }

      const { id } = req.params;
      const offerLetterPath = req.file.path;

      const result = await pool.query(
        'UPDATE job_applications SET offer_letter = $1 WHERE id = $2 RETURNING *',
        [offerLetterPath, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ 
          success: false,
          error: 'Application not found' 
        });
      }

      res.status(200).json({
        success: true,
        message: 'Offer letter uploaded successfully',
        filePath: `/uploads/${path.basename(offerLetterPath)}`
      });
    } catch (error) {
      console.error('Offer letter upload error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to upload offer letter' 
      });
    }
  }
);

// Serve static files
app.use('/uploads', express.static(uploadsDir));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);

  if (err instanceof multer.MulterError) {
    return res.status(400).json({ 
      success: false,
      error: 'File upload error',
      message: err.message 
    });
  }

  res.status(500).json({ 
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Endpoint not found' 
  });
});

// Start server
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully');
  server.close(() => {
    pool.end();
    console.log('Server closed. Database connection pool ended');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully');
  server.close(() => {
    pool.end();
    console.log('Server closed. Database connection pool ended');
    process.exit(0);
  });
});

module.exports = app;
