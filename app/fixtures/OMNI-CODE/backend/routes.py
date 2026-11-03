from flask import Blueprint, jsonify, abort
from .models import Data

bp = Blueprint('api', __name__)

@bp.route('/data/<int:resource_id>')
def get_data(resource_id):
    resource = Data.query.get(resource_id)
    if resource is None:
        abort(404, description="Resource not found")
    return jsonify(resource.to_dict())
