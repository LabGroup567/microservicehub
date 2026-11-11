const db = require('./db');

async function hasColumn(table, column) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function addColumn(table, column, definition) {
  if (!(await hasColumn(table, column))) {
    await db.query(
      `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`
    );
  }
}

async function addIndex(table, name, columns) {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name]
  );
  if (!rows.length) {
    await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${columns})`);
  }
}

const TABLE_OPTIONS =
  'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

// Core tables, created when the database is empty (fresh install, tests, deployment).
async function ensureBaseSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('seeker','provider','admin') NOT NULL DEFAULT 'seeker',
      phone VARCHAR(20) DEFAULT NULL,
      nid_status ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      google_id VARCHAR(255) DEFAULT NULL,
      UNIQUE KEY email (email),
      UNIQUE KEY google_id (google_id)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(255) DEFAULT NULL,
      UNIQUE KEY name (name)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS services (
      id INT AUTO_INCREMENT PRIMARY KEY,
      seeker_id INT NOT NULL,
      category_id INT DEFAULT NULL,
      title VARCHAR(150) NOT NULL,
      description TEXT NOT NULL,
      location VARCHAR(200) NOT NULL,
      budget DECIMAL(10,2) NOT NULL,
      status ENUM('open','assigned','in_progress','completed','cancelled') NOT NULL DEFAULT 'open',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY seeker_id (seeker_id),
      KEY category_id (category_id),
      CONSTRAINT services_ibfk_1 FOREIGN KEY (seeker_id) REFERENCES users(id),
      CONSTRAINT services_ibfk_2 FOREIGN KEY (category_id) REFERENCES categories(id)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_id INT NOT NULL,
      provider_id INT NOT NULL,
      message TEXT DEFAULT NULL,
      status ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_application (service_id, provider_id),
      KEY provider_id (provider_id),
      CONSTRAINT applications_ibfk_1 FOREIGN KEY (service_id) REFERENCES services(id),
      CONSTRAINT applications_ibfk_2 FOREIGN KEY (provider_id) REFERENCES users(id)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_services (
      id INT AUTO_INCREMENT PRIMARY KEY,
      provider_id INT NOT NULL,
      category_id INT DEFAULT NULL,
      title VARCHAR(150) NOT NULL,
      description TEXT NOT NULL,
      location VARCHAR(200) NOT NULL,
      price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_provider_services_provider (provider_id),
      KEY idx_provider_services_category (category_id),
      CONSTRAINT fk_provider_services_category FOREIGN KEY (category_id) REFERENCES categories(id),
      CONSTRAINT fk_provider_services_provider FOREIGN KEY (provider_id) REFERENCES users(id)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_id INT NOT NULL,
      provider_service_id INT NOT NULL,
      preferred_date DATE NOT NULL,
      message TEXT NOT NULL,
      status ENUM('pending','accepted','rejected','completed','cancelled') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_bookings_customer (customer_id),
      KEY idx_bookings_service (provider_service_id),
      CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_id) REFERENCES users(id),
      CONSTRAINT fk_bookings_provider_service FOREIGN KEY (provider_service_id) REFERENCES provider_services(id)
    ) ${TABLE_OPTIONS}
  `);

  // Starter categories so a new install is usable straight away.
  const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM categories');
  if (total === 0) {
    await db.query('INSERT INTO categories (name, description) VALUES ?', [[
      ['Delivery', 'Parcels, groceries and errands'],
      ['Home Care', 'Cleaning, laundry and household help'],
      ['Repairs', 'Plumbing, electrical and appliance repair'],
      ['Daily Tasks', 'Shopping, queueing and small jobs'],
      ['Technology', 'Phone, computer and Wi-Fi help'],
      ['Moving', 'Shifting and heavy lifting'],
    ]]);
  }
}

// Idempotent: safe to run on every start.
async function ensureSchema() {
  await ensureBaseSchema();

  // 1. Every table exists before anything refers to it.
  await db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_id INT DEFAULT NULL,
      booking_id INT DEFAULT NULL,
      payer_id INT NOT NULL,
      payee_id INT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      method ENUM('cash','nagad') NOT NULL,
      status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
      trx_id VARCHAR(40) DEFAULT NULL,
      sender_number VARCHAR(20) DEFAULT NULL,
      note VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMP NULL DEFAULT NULL,
      UNIQUE KEY uq_payment_trx (method, trx_id),
      KEY idx_payment_service (service_id),
      KEY idx_payment_booking (booking_id),
      KEY idx_payment_payer (payer_id),
      KEY idx_payment_payee (payee_id),
      CONSTRAINT fk_payment_payer FOREIGN KEY (payer_id) REFERENCES users(id),
      CONSTRAINT fk_payment_payee FOREIGN KEY (payee_id) REFERENCES users(id)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS kyc_documents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      doc_type ENUM('nid_front','nid_back','selfie') NOT NULL,
      file_name VARCHAR(120) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_kyc_doc (user_id, doc_type),
      CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reviewer_id INT NOT NULL,
      provider_id INT NOT NULL,
      service_id INT DEFAULT NULL,
      booking_id INT DEFAULT NULL,
      rating TINYINT NOT NULL,
      comment VARCHAR(1000) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_review_service (reviewer_id, service_id),
      UNIQUE KEY uq_review_booking (reviewer_id, booking_id),
      KEY idx_review_provider (provider_id),
      CONSTRAINT fk_review_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id),
      CONSTRAINT fk_review_provider FOREIGN KEY (provider_id) REFERENCES users(id)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sender_id INT NOT NULL,
      receiver_id INT NOT NULL,
      body VARCHAR(2000) NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_msg_pair (sender_id, receiver_id),
      KEY idx_msg_receiver (receiver_id, is_read),
      CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id),
      CONSTRAINT fk_msg_receiver FOREIGN KEY (receiver_id) REFERENCES users(id)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      type VARCHAR(40) NOT NULL,
      title VARCHAR(200) NOT NULL,
      body VARCHAR(500) DEFAULT NULL,
      link VARCHAR(200) DEFAULT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_notif_user (user_id, is_read),
      CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      endpoint VARCHAR(500) NOT NULL,
      p256dh VARCHAR(255) NOT NULL,
      auth VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_push_endpoint (endpoint),
      KEY idx_push_user (user_id),
      CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_invites (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(150) NOT NULL,
      invited_by INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_invite_email (email),
      CONSTRAINT fk_invite_by FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      type ENUM('reset','verify') NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_token_hash (token_hash),
      KEY idx_token_user (user_id, type),
      CONSTRAINT fk_token_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reporter_id INT NOT NULL,
      target_type ENUM('user','work','listing') NOT NULL,
      target_id INT NOT NULL,
      reason VARCHAR(500) NOT NULL,
      status ENUM('open','resolved','dismissed') NOT NULL DEFAULT 'open',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_report_status (status),
      CONSTRAINT fk_report_reporter FOREIGN KEY (reporter_id) REFERENCES users(id)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS images (
      id INT AUTO_INCREMENT PRIMARY KEY,
      owner_id INT NOT NULL,
      mime VARCHAR(40) NOT NULL,
      data MEDIUMBLOB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_images_owner (owner_id),
      CONSTRAINT fk_images_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS settings (
      name VARCHAR(60) PRIMARY KEY,
      value VARCHAR(255) NOT NULL
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(30) NOT NULL,
      kind ENUM('percent','fixed') NOT NULL,
      value DECIMAL(10,2) NOT NULL,
      max_uses INT DEFAULT NULL,
      used_count INT NOT NULL DEFAULT 0,
      expires_on DATE DEFAULT NULL,
      user_id INT DEFAULT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_promo_code (code)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_days_off (
      provider_id INT NOT NULL,
      day DATE NOT NULL,
      PRIMARY KEY (provider_id, day),
      CONSTRAINT fk_days_off_provider FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS disputes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      service_id INT DEFAULT NULL,
      booking_id INT DEFAULT NULL,
      opener_id INT NOT NULL,
      against_id INT NOT NULL,
      reason VARCHAR(1000) NOT NULL,
      status ENUM('open','released','refunded','dismissed') NOT NULL DEFAULT 'open',
      resolution_note VARCHAR(500) DEFAULT NULL,
      resolved_by INT DEFAULT NULL,
      resolved_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_dispute_status (status),
      KEY idx_dispute_service (service_id),
      KEY idx_dispute_booking (booking_id),
      CONSTRAINT fk_dispute_opener FOREIGN KEY (opener_id) REFERENCES users(id),
      CONSTRAINT fk_dispute_against FOREIGN KEY (against_id) REFERENCES users(id)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL,
      message VARCHAR(2000) NOT NULL,
      handled TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_contact_handled (handled, id)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INT NOT NULL,
      provider_id INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, provider_id),
      CONSTRAINT fk_fav_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_fav_provider FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_portfolio (
      id INT AUTO_INCREMENT PRIMARY KEY,
      provider_id INT NOT NULL,
      image_id INT NOT NULL,
      caption VARCHAR(120) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_portfolio_provider (provider_id),
      CONSTRAINT fk_portfolio_provider FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  // Providers who switched on "Available now": an approximate spot, refreshed while their page is open.
  await db.query(`
    CREATE TABLE IF NOT EXISTS provider_presence (
      provider_id INT PRIMARY KEY,
      lat DECIMAL(8,5) NOT NULL,
      lng DECIMAL(8,5) NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_presence_provider FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  // Emergency help: blood donors, blood requests, and donors who answered a request.
  await db.query(`
    CREATE TABLE IF NOT EXISTS blood_donors (
      user_id INT PRIMARY KEY,
      blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
      area VARCHAR(100) NOT NULL,
      is_available TINYINT(1) NOT NULL DEFAULT 1,
      share_phone TINYINT(1) NOT NULL DEFAULT 0,
      last_donated DATE DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_blood_donors_group (blood_group, is_available),
      CONSTRAINT fk_blood_donor_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS blood_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      requester_id INT NOT NULL,
      blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
      units TINYINT NOT NULL DEFAULT 1,
      hospital VARCHAR(150) NOT NULL,
      area VARCHAR(100) NOT NULL,
      note VARCHAR(300) DEFAULT NULL,
      contact_phone VARCHAR(20) NOT NULL,
      urgent TINYINT(1) NOT NULL DEFAULT 0,
      status ENUM('open','fulfilled','closed') NOT NULL DEFAULT 'open',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      KEY idx_blood_requests_open (status, expires_at),
      KEY idx_blood_requests_user (requester_id),
      CONSTRAINT fk_blood_request_user FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS blood_offers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_id INT NOT NULL,
      donor_id INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_blood_offer (request_id, donor_id),
      CONSTRAINT fk_blood_offer_request FOREIGN KEY (request_id) REFERENCES blood_requests(id) ON DELETE CASCADE,
      CONSTRAINT fk_blood_offer_donor FOREIGN KEY (donor_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  // Donors added by an admin (for example people who walked in or phoned): they have no account.
  await db.query(`
    CREATE TABLE IF NOT EXISTS blood_donors_managed (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
      area VARCHAR(100) NOT NULL,
      is_available TINYINT(1) NOT NULL DEFAULT 1,
      share_phone TINYINT(1) NOT NULL DEFAULT 1,
      last_donated DATE DEFAULT NULL,
      added_by INT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_blood_managed_group (blood_group, is_available)
    ) ${TABLE_OPTIONS}
  `);

  // Emergency services run by the admins: ambulances (with a live position), doctors, and checkup requests.
  await db.query(`
    CREATE TABLE IF NOT EXISTS ambulances (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      driver_name VARCHAR(100) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      vehicle_no VARCHAR(40) DEFAULT NULL,
      area VARCHAR(100) NOT NULL,
      status ENUM('available','busy','off') NOT NULL DEFAULT 'available',
      lat DECIMAL(9,6) DEFAULT NULL,
      lng DECIMAL(9,6) DEFAULT NULL,
      location_at DATETIME DEFAULT NULL,
      track_token CHAR(32) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_ambulance_token (track_token)
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ambulance_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ambulance_id INT NOT NULL,
      user_id INT NOT NULL,
      pickup VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      note VARCHAR(300) DEFAULT NULL,
      status ENUM('active','completed','cancelled') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME DEFAULT NULL,
      KEY idx_amb_req_user (user_id, status),
      KEY idx_amb_req_amb (ambulance_id, status),
      CONSTRAINT fk_amb_req_amb FOREIGN KEY (ambulance_id) REFERENCES ambulances(id) ON DELETE CASCADE,
      CONSTRAINT fk_amb_req_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL,
      specialty VARCHAR(100) NOT NULL,
      qualification VARCHAR(150) DEFAULT NULL,
      reg_no VARCHAR(60) NOT NULL,
      fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      bio VARCHAR(300) DEFAULT NULL,
      phone VARCHAR(20) DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ${TABLE_OPTIONS}
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS checkups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      doctor_id INT NOT NULL,
      reason VARCHAR(500) NOT NULL,
      preferred_time VARCHAR(100) DEFAULT NULL,
      status ENUM('pending','approved','rejected','cancelled','completed') NOT NULL DEFAULT 'pending',
      meeting_link VARCHAR(500) DEFAULT NULL,
      meeting_time VARCHAR(100) DEFAULT NULL,
      admin_note VARCHAR(300) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME DEFAULT NULL,
      KEY idx_checkup_user (user_id, status),
      KEY idx_checkup_status (status),
      CONSTRAINT fk_checkup_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_checkup_doctor FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
    ) ${TABLE_OPTIONS}
  `);

  // 2. Columns added after the first release, then indexes.

  // A doctor's registration number or an ambulance's licence number, shown on the listing.
  await addColumn('provider_services', 'credential', 'VARCHAR(80) DEFAULT NULL');

  // A provider can offer their own price when they apply. Open work closes itself after 30 days.
  await addColumn('applications', 'offer_price', 'DECIMAL(10,2) DEFAULT NULL');
  await addColumn('users', 'avatar_image_id', 'INT DEFAULT NULL');
  if (!(await hasColumn('services', 'expires_at'))) {
    await addColumn('services', 'expires_at', 'DATETIME DEFAULT NULL');
    await db.query('UPDATE services SET expires_at = DATE_ADD(created_at, INTERVAL 30 DAY) WHERE expires_at IS NULL');
  }

  await addColumn('users', 'is_banned', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('users', 'bio', 'VARCHAR(500) DEFAULT NULL');
  await addColumn('users', 'nid_number', 'VARCHAR(30) DEFAULT NULL');
  await addColumn('users', 'has_password', 'TINYINT(1) NOT NULL DEFAULT 1');
  await addColumn('users', 'email_verified', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('users', 'admin_level', "ENUM('none','sub','full') NOT NULL DEFAULT 'none'");
  // Anyone who was an admin before levels existed keeps full access.
  await db.query("UPDATE users SET admin_level = 'full' WHERE role = 'admin' AND admin_level = 'none'");
  await addColumn('users', 'notify_email', 'TINYINT(1) NOT NULL DEFAULT 1');
  await addColumn('users', 'notify_sms', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('users', 'is_main_admin', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('users', 'phone_visible', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('users', 'accepts_cash', 'TINYINT(1) NOT NULL DEFAULT 1');
  await addColumn('users', 'nagad_number', 'VARCHAR(20) DEFAULT NULL');
  await addColumn('users', 'kyc_status', "ENUM('none','pending','verified','rejected') NOT NULL DEFAULT 'none'");
  await addColumn('users', 'kyc_reason', 'VARCHAR(255) DEFAULT NULL');
  await addColumn('users', 'kyc_full_name', 'VARCHAR(100) DEFAULT NULL');
  await addColumn('users', 'kyc_dob', 'DATE DEFAULT NULL');
  await addColumn('users', 'kyc_submitted_at', 'TIMESTAMP NULL DEFAULT NULL');
  await addColumn('services', 'assigned_provider_id', 'INT(11) DEFAULT NULL');
  await addColumn('services', 'is_hidden', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('provider_services', 'is_hidden', 'TINYINT(1) NOT NULL DEFAULT 0');

  // There are only two admin tiers: one main admin and any number of sub admins.
  const [[mains]] = await db.query("SELECT COUNT(*) AS c FROM users WHERE is_main_admin = 1");
  if (!mains.c) {
    await db.query("UPDATE users SET is_main_admin = 1 WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
  }
  await db.query("UPDATE users SET admin_level = 'sub' WHERE role = 'admin' AND is_main_admin = 0 AND admin_level <> 'sub'");

  await addColumn('services', 'image_id', 'INT DEFAULT NULL');
  await addColumn('provider_services', 'image_id', 'INT DEFAULT NULL');
  await db.query('ALTER TABLE reviews MODIFY rating TINYINT NULL');
  await addColumn('users', 'kyc_method', "ENUM('nid','birth_certificate') NOT NULL DEFAULT 'nid'");
  await addColumn('users', 'birth_cert_number', 'VARCHAR(30) DEFAULT NULL');
  await db.query(
    "ALTER TABLE kyc_documents MODIFY doc_type ENUM('nid_front','nid_back','selfie','birth_certificate') NOT NULL"
  );
  await addColumn('payments', 'fee_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');
  await addColumn('payments', 'discount_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');
  await addColumn('payments', 'promo_code', 'VARCHAR(30) DEFAULT NULL');
  await addColumn('payments', 'charged_amount', 'DECIMAL(10,2) DEFAULT NULL');
  await addColumn('payments', 'escrow_status', "ENUM('none','held','disputed','released','refunded') NOT NULL DEFAULT 'none'");
  await addColumn('payments', 'refund_status', "ENUM('none','due','sent') NOT NULL DEFAULT 'none'");
  await addColumn('users', 'referral_code', 'VARCHAR(12) DEFAULT NULL');
  await addColumn('users', 'referred_by', 'INT DEFAULT NULL');
  await addColumn('users', 'referral_rewarded', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addIndex('users', 'idx_users_referral', 'referral_code');
  await addIndex('payments', 'idx_payment_escrow', 'escrow_status');

  // fee_percent starts at 0 so nothing changes until the main admin sets a fee.
  await db.query("INSERT IGNORE INTO settings (name, value) VALUES ('fee_percent', '0'), ('referral_bonus', '50')");

  await addIndex('notifications', 'idx_notif_created', 'user_id, created_at');
  await addIndex('messages', 'idx_msg_created', 'receiver_id, created_at');

  await addColumn('kyc_documents', 'data', 'MEDIUMBLOB NULL');
  await addColumn('kyc_documents', 'mime', 'VARCHAR(40) NULL');
  await db.query('ALTER TABLE kyc_documents MODIFY file_name VARCHAR(120) NULL');
  await addColumn('payments', 'gateway', 'VARCHAR(20) DEFAULT NULL');
  await addColumn('payments', 'gateway_ref', 'VARCHAR(80) DEFAULT NULL');
  await addColumn('payments', 'payout_status', "ENUM('none','due','paid_out') NOT NULL DEFAULT 'none'");
  await addColumn('payments', 'payout_at', 'TIMESTAMP NULL DEFAULT NULL');
  await addColumn('payments', 'payout_note', 'VARCHAR(255) DEFAULT NULL');
  await addIndex('payments', 'idx_payment_gateway', 'gateway, gateway_ref');
  await addIndex('payments', 'idx_payment_payout', 'payout_status');

  // Online payments that were already queued for payout before escrow existed stay as they are.
  await db.query(
    "UPDATE payments SET escrow_status = 'released' WHERE gateway IS NOT NULL AND status = 'paid' AND payout_status <> 'none' AND escrow_status = 'none'"
  );
  await addIndex('services', 'idx_services_browse', 'status, is_hidden, created_at');
  await addIndex('services', 'idx_services_provider', 'assigned_provider_id');
  await addIndex('provider_services', 'idx_ps_browse', 'status, is_hidden, created_at');
  await addIndex('applications', 'idx_app_service_status', 'service_id, status');
  await addIndex('bookings', 'idx_bookings_status', 'status');

  await db.query(
    `ALTER TABLE bookings MODIFY status
     ENUM('pending','accepted','in_progress','rejected','completed','cancelled')
     NOT NULL DEFAULT 'pending'`
  );

  // More kinds of service. This runs once: a category an admin removes later does not come back.
  const [[seeded]] = await db.query("SELECT COUNT(*) AS c FROM settings WHERE name = 'categories_v2'");
  if (!seeded.c) {
    await db.query('INSERT IGNORE INTO categories (name, description) VALUES ?', [[
      ['Tutoring', 'Home tutors for school, college and languages'],
      ['Beauty and Salon', 'Haircut, makeup and spa at home'],
      ['Cooking and Catering', 'Home cooks, tiffin and food for events'],
      ['Gardening', 'Plants, lawn and rooftop garden care'],
      ['Pet Care', 'Walking, feeding and grooming'],
      ['Photography', 'Photos and video for events and products'],
      ['Event Help', 'Decoration, setup and helpers for events'],
      ['Driving', 'Drivers and ride help'],
      ['Child and Elder Care', 'Babysitters, attendants and companions'],
      ['Health Care', 'Nurse visits, physiotherapy and sample collection'],
      ['Laundry and Ironing', 'Washing, ironing and dry cleaning'],
      ['Deep Cleaning', 'Sofa, carpet, kitchen and water tank cleaning'],
      ['Painting', 'Wall painting and polish'],
      ['Plumbing', 'Taps, pipes and bathroom fittings'],
      ['Electrical', 'Wiring, fans and light fitting'],
      ['AC and Appliance Service', 'AC servicing, fridge and washing machine repair'],
      ['Carpentry', 'Furniture making and repair'],
      ['Pest Control', 'Cockroach, termite and mosquito control'],
      ['Car and Bike Care', 'Washing, servicing and small repairs'],
      ['Tailoring', 'Stitching and alterations'],
      ['Design and Web', 'Logos, banners, posters and websites'],
      ['Typing and Translation', 'Documents, typing and translation'],
    ]]);
    await db.query("INSERT IGNORE INTO settings (name, value) VALUES ('categories_v2', '1')");
  }

  // A second batch of service types, also added once.
  const [[seededV3]] = await db.query("SELECT COUNT(*) AS c FROM settings WHERE name = 'categories_v3'");
  if (!seededV3.c) {
    await db.query('INSERT IGNORE INTO categories (name, description) VALUES ?', [[
      ['Security Guard', 'Short-term guards and watchmen'],
      ['Tour Guide', 'Local guides and travel help'],
      ['Mobile Repair', 'Phone screen, battery and software fixes'],
      ['Computer Repair', 'Laptop and desktop repair, Windows install'],
      ['CCTV and Security Systems', 'Camera and alarm setup'],
      ['Internet and Wi-Fi Setup', 'Router, cable and network setup'],
      ['Solar and Generator', 'Solar panel, IPS and generator service'],
      ['Masonry and Construction', 'Brickwork, plastering and small building jobs'],
      ['Tiles and Flooring', 'Tile, marble and floor fitting'],
      ['Glass and Aluminium', 'Windows, doors and partitions'],
      ['Welding and Metalwork', 'Grills, gates and metal repair'],
      ['Gas and Water Delivery', 'Cylinder and drinking water delivery'],
      ['Printing and Photocopy', 'Printing, binding and document copies'],
      ['Document Help', 'Passport, NID, trade licence and form filling help'],
      ['Fitness and Yoga', 'Personal trainers and yoga classes'],
      ['Music and Dance Lessons', 'Teachers for music, dance and art'],
      ['Religious Teaching', 'Quran and other home teachers'],
      ['Language Classes', 'English and other languages'],
      ['Wedding Services', 'Decoration, makeup and planning for weddings'],
      ['Video Editing', 'Editing for events, YouTube and business'],
      ['Social Media Help', 'Page setup, posts and ads'],
      ['Data Entry', 'Typing, spreadsheets and data work'],
      ['Waste and Recycling', 'Garbage pickup and old goods'],
      ['Interior Design', 'Room design and home decoration'],
    ]]);
    await db.query("INSERT IGNORE INTO settings (name, value) VALUES ('categories_v3', '1')");
  }

  // Emergency service types, added once.
  const [[seededV4]] = await db.query("SELECT COUNT(*) AS c FROM settings WHERE name = 'categories_v4'");
  if (!seededV4.c) {
    await db.query('INSERT IGNORE INTO categories (name, description) VALUES ?', [[
      ['Ambulance', 'Ambulance and patient transport, day and night'],
      ['Online Doctor', 'Talk to a registered doctor by chat or call'],
    ]]);
    await db.query("INSERT IGNORE INTO settings (name, value) VALUES ('categories_v4', '1')");
  }
}

module.exports = { ensureSchema };
