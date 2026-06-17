FROM node:26-bullseye

RUN apt-get update && apt-get install -y git wait-for-it
RUN npm install -g npm@11.17.0

RUN node -v && npm -v 

WORKDIR /workspace

CMD ["sleep", "infinity"] 