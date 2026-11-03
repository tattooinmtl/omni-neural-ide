from flask import Blueprint, jsonify, abort
from ..models import Data

bp = Blueprint("api", __name__)

@bp.get("/data/<id>")
def get_data(id):
    row = Data.query.get(id)
    if row is None:
        abort(404)
    return jsonify(row.to_dict())
