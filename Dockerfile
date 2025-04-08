FROM php:7.4-cli-alpine

# Variables de versión
ENV NODE_VERSION=20.11.1

# Instala dependencias necesarias
RUN apk add --no-cache \
    $PHPIZE_DEPS \
    libxml2-dev \
    linux-headers \
    bash \
    git \
    curl \
    python3 \
    make \
    g++ \
    zip \
    ca-certificates \
    tar \
    xz \
    openssl

# Instala Node.js desde los binarios oficiales
RUN curl -fsSL https://unofficial-builds.nodejs.org/download/release/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64-musl.tar.xz | tar -xJ -C /usr/local --strip-components=1 --no-same-owner \
    && ln -s /usr/local/bin/node /usr/bin/node \
    && ln -s /usr/local/bin/npm /usr/bin/npm \
    && ln -s /usr/local/bin/npx /usr/bin/npx

# Copia Composer desde imagen oficial
COPY --from=composer:2.5.1 /usr/bin/composer /usr/bin/composer

# Instala PHPUnit
RUN composer global require phpunit/phpunit ~9

# Alias para phpunit
RUN echo 'alias phpunit="~/.composer/vendor/bin/phpunit"' >> ~/.bashrc
