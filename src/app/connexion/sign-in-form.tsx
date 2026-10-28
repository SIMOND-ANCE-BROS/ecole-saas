"use client";

import { Button, PasswordInput, Text, TextInput } from "@mantine/core";
import { useActionState } from "react";
import { type ConnectionState, signIn } from "./actions";
import { SIGN_IN } from "./fields";

const initialState: ConnectionState = { error: null, email: "" };

export function SignInForm() {
  const [state, action, inProgress] = useActionState(signIn, initialState);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <TextInput
        id="email"
        label="Adresse e-mail"
        name={SIGN_IN.name("email")}
        type="email"
        autoComplete="username"
        required
        withAsterisk={false}
        autoFocus
        defaultValue={state.email}
      />
      <PasswordInput
        id="password"
        label="Mot de passe"
        name={SIGN_IN.name("password")}
        autoComplete="current-password"
        required
        withAsterisk={false}
      />
      {state.error && (
        <Text role="alert" size="sm" c="red">
          {state.error}
        </Text>
      )}
      <Button type="submit" loading={inProgress}>
        Se connecter
      </Button>
    </form>
  );
}
