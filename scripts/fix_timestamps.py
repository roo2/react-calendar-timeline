from sqlalchemy import create_engine, text

def main() -> None:
	engine = create_engine("sqlite:///./production.db", future=True)
	with engine.begin() as conn:
		conn.execute(text("UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE created_at = 'now()'"))
		conn.execute(text("UPDATE sessions SET created_at = CURRENT_TIMESTAMP WHERE created_at = 'now()'"))
	print("Fixed bad timestamp rows (if any).")


if __name__ == "__main__":
	main()


