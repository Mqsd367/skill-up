import pytest, sqlite3, app as appmod, recommend, roadmap_service as rs

GOOD = {"goal": "Learn Flask", "level": "Beginner", "daily": 30, "weeks": 6, "pref": "Mixed"}
RM = {"title": "T", "modules": [
    {"title": "A", "topics": ["a1", "a2"], "practice": ["pa"], "resources": [{"label": "x", "url": "https://docs.python.org"}, {"label": "bad", "url": "http://x"}]},
    {"title": "B", "topics": ["b1"], "requires": [0], "practice": []}], "total_hours": 3}

@pytest.fixture
def make(tmp_path):
    appmod._hits.clear(); a = appmod.create_app(db_path=str(tmp_path / "t.db")); a.config["TESTING"] = True
    return lambda: a.test_client(), a

def user(make, email="a@x.com"):
    c = make[0](); r = c.post("/api/auth/register", json={"email": email, "password": "password1"}); assert r.status_code == 201; return c

def test_home_health(make):
    c = make[0](); assert c.get("/").status_code == 200 and c.get("/api/health").get_json()["ok"]

def test_register_validation_and_duplicate(make):
    c = make[0]()
    assert c.post("/api/auth/register", json={"email": "bad", "password": "password1"}).status_code == 400
    assert c.post("/api/auth/register", json={"email": "a@x.com", "password": "short"}).status_code == 400
    assert c.post("/api/auth/register", data="nope").status_code == 400
    user(make); assert make[0]().post("/api/auth/register", json={"email": "A@x.com", "password": "password1"}).status_code == 409

def test_password_is_hashed(make):
    user(make); con = sqlite3.connect(make[1].config["STORE"].path)
    h = con.execute("select pw_hash from users").fetchone()[0]; assert "password1" not in h

def test_login_logout_me(make):
    user(make); c = make[0]()
    assert c.post("/api/auth/login", json={"email": "a@x.com", "password": "wrong-pass"}).status_code == 401
    assert c.get("/api/auth/me").get_json()["user"] is None
    assert c.post("/api/auth/login", json={"email": "a@x.com", "password": "password1"}).status_code == 200
    assert c.get("/api/auth/me").get_json()["user"]["email"] == "a@x.com"
    c.post("/api/auth/logout"); assert c.get("/api/roadmaps").status_code == 401

@pytest.mark.parametrize("bad", [{}, {**GOOD, "goal": "x"}, {**GOOD, "level": "Pro"}, {**GOOD, "weeks": 99}, {**GOOD, "daily": 7}])
def test_invalid_requests(make, bad): assert make[0]().post("/api/roadmap", json=bad).status_code == 400

def test_malformed_body(make): assert make[0]().post("/api/roadmap", data="nope").status_code == 400

def test_gemini_missing_and_failures(make, monkeypatch):
    c = make[0](); monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert c.post("/api/roadmap", json=GOOD).status_code == 501
    monkeypatch.setattr(rs, "call_gemini", lambda p: (_ for _ in ()).throw(rs.AIError("quota", 429)))
    assert c.post("/api/roadmap", json=GOOD).status_code == 429
    monkeypatch.setattr(rs, "call_gemini", lambda p: "not json"); appmod._hits.clear()
    assert c.post("/api/roadmap", json=GOOD).status_code == 502

def test_validate_roadmap_filters_urls():
    out = rs.validate_roadmap(RM)
    assert [r["url"] for r in out["modules"][0]["resources"]] == ["https://docs.python.org"]
    with pytest.raises(rs.AIError): rs.validate_roadmap({"title": "x", "modules": []})

def test_ownership(make):
    a, b = user(make, "a@x.com"), user(make, "b@x.com")
    rid = a.post("/api/roadmaps", json={"roadmap": RM}).get_json()["id"]
    assert a.get(f"/api/roadmaps/{rid}").status_code == 200
    assert b.get(f"/api/roadmaps/{rid}").status_code == 404
    assert b.delete(f"/api/roadmaps/{rid}").status_code == 404
    assert b.patch(f"/api/roadmaps/{rid}/progress", json={"completed": []}).status_code == 404
    assert b.get("/api/roadmaps").get_json()["roadmaps"] == []
    assert make[0]().get("/api/roadmaps").status_code == 401

def test_progress_and_delete(make):
    a = user(make); rid = a.post("/api/roadmaps", json={"roadmap": RM}).get_json()["id"]
    r = a.patch(f"/api/roadmaps/{rid}/progress", json={"completed": ["0:0"]}).get_json()
    assert r["progress"] == 33 and r["next_step"]["topic"] == "a2"
    assert a.patch(f"/api/roadmaps/{rid}/progress", json={"completed": ["9:9"]}).status_code == 400
    assert a.get("/api/roadmaps").get_json()["roadmaps"][0]["completed"] == ["0:0"]
    assert a.delete(f"/api/roadmaps/{rid}").status_code == 200 and a.get(f"/api/roadmaps/{rid}").status_code == 404

def test_progress_with_timers(make):
    a = user(make)
    rm_with_timers = {**RM, "timers": {"0:0": {"targetMinutes": 25}}}
    rid = a.post("/api/roadmaps", json={"roadmap": rm_with_timers}).get_json()["id"]
    saved = a.get(f"/api/roadmaps/{rid}").get_json()["roadmap"]
    assert saved.get("timers", {}).get("0:0", {}).get("targetMinutes") == 25
    r = a.patch(f"/api/roadmaps/{rid}/progress", json={"completed": ["0:0"], "timers": {"0:1": {"targetMinutes": 45}}}).get_json()
    assert r["progress"] == 33
    updated = a.get(f"/api/roadmaps/{rid}").get_json()["roadmap"]
    assert updated.get("timers", {}).get("0:1", {}).get("targetMinutes") == 45

def test_recommendation_rules():
    rm = rs.validate_roadmap(RM)
    assert recommend.next_step(rm, [])["topic"] == "a1"
    s = recommend.next_step(rm, ["0:0", "0:1"]); assert s["topic"] == "b1" and "builds on 'A'" in s["why"]
    assert recommend.next_step(rm, ["0:0", "0:1", "1:0"])["done"] is True
