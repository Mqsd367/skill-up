# SkillUp (Flask + SQLite + Gemini)

No Firebase needed: accounts and roadmaps live in a local SQLite file (`skillup.db`, created automatically).

## Windows setup
```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python -m pytest -q
python app.py
```
Open http://127.0.0.1:5000. Edit `.env`: set `GEMINI_API_KEY` (https://aistudio.google.com/apikey) and a long random `SECRET_KEY`.
Without a Gemini key the app shows clearly labelled demo roadmaps.

## API
`POST /api/auth/register|login|logout` · `GET /api/auth/me` · `POST /api/roadmap` (generate) · `POST /api/roadmaps` (save) ·
`GET /api/roadmaps` · `GET /api/roadmaps/<id>` · `PATCH /api/roadmaps/<id>/progress {"completed":["0:0"]}` · `DELETE /api/roadmaps/<id>`

## Deploy
Debug off. `waitress-serve --port=8000 app:app`. Set `SECRET_KEY`, `GEMINI_API_KEY`, `COOKIE_SECURE=1` (HTTPS only). Keep `skillup.db` on persistent storage.
