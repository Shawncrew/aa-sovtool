import os
from setuptools import find_packages, setup

with open(os.path.join(os.path.dirname(__file__), "README.md"), encoding="utf-8") as readme:
    long_description = readme.read()

setup(
    name="aa-sovtool",
    version="0.1.3",
    description="Alliance Auth app for EVE Online Equinox sovereignty planning, structures, and access lists.",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="NCdot",
    license="MIT",
    packages=find_packages(),
    include_package_data=True,
    python_requires=">=3.10",
    install_requires=[
        "allianceauth>=4.0.0",
        "django-esi>=5.0.0",
        "celery>=5.2.0",
        "requests>=2.31.0",
    ],
    classifiers=[
        "Environment :: Web Environment",
        "Framework :: Django",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Internet :: WWW/HTTP",
    ],
)
