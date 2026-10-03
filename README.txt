BUYER FINDER - setup (sirf 4 steps)

1. Node.js install karo (nodejs.org, LTS version 18 ya upar).
2. Is folder me terminal kholo aur chalao:   npm install
3. ".env.example" file ka naam ".env" kar do aur andar apni keys daalo:
     GOOGLE_KEY  -> Google Cloud Console > Places API (New) enable > API key
     HUNTER_KEY  -> hunter.io > Dashboard > API
     GMAIL_USER / GMAIL_PASS -> Gmail 2-step verification on karo, phir "App Password" banao
4. Chalao:   npm start      phir browser me kholo:  http://localhost:5000

Demo ke time sirf apne test email addresses par mail bhejo.
