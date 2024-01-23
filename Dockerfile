FROM php:7.4-cli-alpine

RUN apk add --no-cache $PHPIZE_DEPS \
	libxml2-dev \
	php-soap linux-headers bash \
	git 

COPY --from=composer:2.5.1 /usr/bin/composer /usr/bin/composer

RUN composer global require phpunit/phpunit  ~9

RUN echo 'alias phpunit="./vendor/bin/phpunit"' >> ~/.bashrc