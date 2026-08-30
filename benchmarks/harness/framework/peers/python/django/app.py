# django — the-benchmarker contract, single-file (served by gunicorn: app:application)
import os
from django.conf import settings
from django.http import HttpResponse
from django.urls import path, re_path
from django.core.wsgi import get_wsgi_application

if not settings.configured:
    settings.configure(
        DEBUG=False,
        ALLOWED_HOSTS=["*"],
        ROOT_URLCONF=__name__,
        SECRET_KEY="bench",
        MIDDLEWARE=[],
        DATABASES={},
        LOGGING_CONFIG=None,
    )

def root(_request):
    return HttpResponse("")

def user(_request, id):
    return HttpResponse(id)

def create(_request):
    return HttpResponse("")

urlpatterns = [
    path("", root),
    re_path(r"^user/(?P<id>[^/]+)$", user),
    path("user", create),
]

application = get_wsgi_application()
