"""Shared pytest fixtures for backend tests — bootstraps a test admin user and
exposes JWT tokens for authenticated requests. Phase 2 (auth) migration."""
import os
import requests
import pytest


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

TEST_ADMIN_USER = "test_admin_ci"
TEST_ADMIN_PWD = "test_admin_ci_pw_1"
TEST_OP_USER = "test_op_ci"
TEST_OP_PWD = "test_op_ci_pw_1"


def _ensure_admin_token():
    """Bootstrap or login as the test admin. Returns (token, user_id)."""
    # Try login first
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PWD},
        timeout=10,
    )
    if r.status_code == 200:
        d = r.json()
        return d["token"], d["user"]["id"]

    # Not present — check if bootstrap available
    bs = requests.get(f"{BASE_URL}/api/auth/bootstrap-status", timeout=5).json()
    if bs.get("needs_bootstrap"):
        r = requests.post(
            f"{BASE_URL}/api/auth/bootstrap",
            json={
                "first_name": "Test",
                "last_name": "AdminCI",
                "username": TEST_ADMIN_USER,
                "password": TEST_ADMIN_PWD,
            },
            timeout=10,
        )
        if r.status_code < 400:
            d = r.json()
            return d["token"], d["user"]["id"]

    # Fallback: no way to get admin token from outside — skip auth-dependent tests
    pytest.skip("cannot bootstrap or login as test admin — auth setup pending")


def _ensure_op_token(admin_token):
    """Get or create the test operator user, return (token, user_id)."""
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": TEST_OP_USER, "password": TEST_OP_PWD},
        timeout=10,
    )
    if r.status_code == 200:
        d = r.json()
        # ensure active
        return d["token"], d["user"]["id"]

    # Create via admin
    r = requests.post(
        f"{BASE_URL}/api/admin/users",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "first_name": "Test",
            "last_name": "OperatorCI",
            "username": TEST_OP_USER,
            "password": TEST_OP_PWD,
            "role": "operator",
        },
        timeout=10,
    )
    if r.status_code == 409:
        # Exists but password mismatched — reset via admin
        list_r = requests.get(
            f"{BASE_URL}/api/admin/users",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=10,
        ).json()
        target = next((u for u in list_r["items"] if u["username"] == TEST_OP_USER), None)
        if target:
            requests.patch(
                f"{BASE_URL}/api/admin/users/{target['id']}",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"active": True},
                timeout=10,
            )
            requests.post(
                f"{BASE_URL}/api/admin/users/{target['id']}/reset-password",
                headers={"Authorization": f"Bearer {admin_token}"},
                json={"new_password": TEST_OP_PWD},
                timeout=10,
            )
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": TEST_OP_USER, "password": TEST_OP_PWD},
        timeout=10,
    )
    d = r.json()
    return d["token"], d["user"]["id"]


@pytest.fixture(scope="session")
def admin_token():
    tok, _ = _ensure_admin_token()
    return tok


@pytest.fixture(scope="session")
def admin_user_id():
    _, uid = _ensure_admin_token()
    return uid


@pytest.fixture(scope="session")
def op_token(admin_token):
    tok, _ = _ensure_op_token(admin_token)
    return tok


@pytest.fixture(scope="session")
def op_user_id(admin_token):
    _, uid = _ensure_op_token(admin_token)
    return uid


@pytest.fixture
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture
def op_headers(op_token):
    return {"Authorization": f"Bearer {op_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL
