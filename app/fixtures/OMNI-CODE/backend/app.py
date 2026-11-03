from flask import Flask
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'postgresql://localhost/omni_db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

def create_app():
    app = Flask(__name__)
    app.config.from_object('config')
    db.init_app(app)

    with app.app_context():
        from .api import routes
        app.register_blueprint(routes.bp)

    return app
