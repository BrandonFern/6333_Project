# SmartLab — Laboratory Equipment Management System

CSCI 6333 Advanced Database Design and Implementation — Class Project

## Overview

SmartLab is a web-based system for managing lab equipment reservations, maintenance tracking, and training certifications at a university. It uses a Python/Flask REST API backed by MySQL, with a vanilla-JS single-page frontend.

## Tech Stack

| Layer    | Technology                         |
|----------|------------------------------------|
| Frontend | HTML5 / CSS3 / Vanilla JavaScript  |
| Backend  | Python 3.x, Flask 3.0              |
| Database | MySQL 8.x                          |
| Auth     | Flask sessions + bcrypt            |
| Server   | Gunicorn (production)              |

## Setup

### 1. Prerequisites

- Python 3.9+
- MySQL 8.x running locally or on AWS RDS
- `pip` for Python packages

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3. Create the database

Log into MySQL and run the schema:

```bash
mysql -u root -p < schema.sql
```

### 4. Configure environment variables

```bash
cp .env.example .env
# Edit .env with your DB credentials and a SECRET_KEY
```

Then export them before running the app:

```bash
# Windows PowerShell
$env:DB_HOST="localhost"; $env:DB_PORT="3306"; $env:DB_NAME="smartlab"
$env:DB_USER="root"; $env:DB_PASS="yourpassword"; $env:SECRET_KEY="dev-secret"

# macOS / Linux (bash)
export DB_HOST=localhost DB_PORT=3306 DB_NAME=smartlab
export DB_USER=root DB_PASS=yourpassword SECRET_KEY=dev-secret
```

### 5. Load seed data

```bash
python seed.py
```

This inserts buildings, departments, equipment types, equipment, users, certifications, and sample reservations.

**Demo accounts** (all use password `SmartLab123!`):

| Email                   | Role        | Notes                              |
|-------------------------|-------------|------------------------------------|
| admin@smartlab.edu      | Admin       | Full access, all certifications    |
| manager@smartlab.edu    | Lab Manager | Can approve reservations           |
| achen@smartlab.edu      | Professor   | Has certifications                 |
| bsmith@smartlab.edu     | Student     | Has Microscope + 3D Printer certs  |
| cdavis@smartlab.edu     | Student     | Cert expiring soon (dashboard demo)|
| delete@smartlab.edu     | Student     | No history — use for DELETE demo   |

### 6. Run the development server

```bash
python api.py
```

Open `http://127.0.0.1:5000` in your browser.

## Role Capabilities

| Feature               | Student | Professor | Lab Manager | Admin |
|-----------------------|---------|-----------|-------------|-------|
| View equipment        | ✓       | ✓         | ✓           | ✓     |
| Make reservation      | ✓       | ✓         | ✓           | ✓     |
| Approve reservation   |         |           | ✓           | ✓     |
| Report maintenance    | ✓       | ✓         | ✓           | ✓     |
| Resolve maintenance   |         |           |             | ✓     |
| Add equipment         |         |           |             | ✓     |
| Edit equipment        |         |           |             | ✓     |
| Retire equipment      |         |           |             | ✓     |
| Grant certification   |         |           |             | ✓     |
| Delete certification  |         |           |             | ✓     |
| View all users        |         |           | ✓           | ✓     |
| Edit user             |         |           |             | ✓     |
| Delete user           |         |           |             | ✓     |
| Analytics             |         |           | ✓           | ✓     |

## Project Structure

```
├── api.py          # Flask REST API (all server-side logic)
├── app.js          # Client-side JavaScript (SPA logic)
├── index.html      # Single HTML shell (all pages embedded)
├── styles.css      # CSS design tokens and layout
├── schema.sql      # MySQL DDL — run once to create tables
├── seed.py         # Demo data insertion script
├── requirements.txt
└── .env.example    # Environment variable template
```

## API Endpoints

| Method | Path                               | Auth         | Description                        |
|--------|------------------------------------|--------------|------------------------------------|
| POST   | /api/auth/login                    | Public       | Login                              |
| POST   | /api/auth/logout                   | Public       | Logout                             |
| POST   | /api/auth/register                 | Public       | Register new user                  |
| GET    | /api/dashboard                     | Login        | Dashboard stats + reservations     |
| GET    | /api/buildings                     | Login        | List all buildings                 |
| GET    | /api/departments                   | Public       | List all departments               |
| GET    | /api/equipment-types               | Login        | List equipment types               |
| GET    | /api/equipment                     | Login        | List/search equipment              |
| POST   | /api/equipment                     | Admin        | Add new equipment                  |
| PATCH  | /api/equipment/:id                 | Admin        | Edit equipment details             |
| DELETE | /api/equipment/:id                 | Admin        | Retire equipment                   |
| GET    | /api/equipment/:id/history         | Login        | Equipment event history            |
| GET    | /api/reservations                  | Login        | List reservations                  |
| POST   | /api/reservations                  | Login        | Create reservation                 |
| PATCH  | /api/reservations/:id/status       | Login        | Update reservation status          |
| GET    | /api/maintenance                   | Login        | List maintenance logs              |
| POST   | /api/maintenance                   | Login        | Report issue                       |
| PATCH  | /api/maintenance/:id/resolve       | Admin        | Resolve maintenance issue          |
| GET    | /api/certifications                | Login        | List certifications                |
| POST   | /api/certifications                | Admin        | Grant certification                |
| DELETE | /api/certifications/:id            | Admin        | Delete certification               |
| GET    | /api/users                         | Admin        | List all users                     |
| PATCH  | /api/users/:id                     | Admin        | Edit user role/department          |
| DELETE | /api/users/:id                     | Admin        | Delete user                        |
| GET    | /api/analytics/utilization         | Admin        | Equipment utilization report       |
| GET    | /api/analytics/idle                | Admin        | Equipment with no reservations     |
| GET    | /api/analytics/totals              | Admin        | System-wide counts                 |
